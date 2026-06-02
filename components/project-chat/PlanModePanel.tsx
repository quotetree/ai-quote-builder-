"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Loader2, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, PlanChatSource } from "@/types/database";
import ScopeMessageBubble from "./ScopeMessageBubble";
import { trackAIChatMessage } from "@/lib/analytics";

export interface ModeChatPanelHandle {
  clearChat: () => Promise<void>;
}

interface PlanModePanelProps {
  projectId: string;
  activeSpreadsheetId?: string | null;
}

function isPlanMessage(msg: ChatMessage): boolean {
  return msg.metadata?.mode === "plan";
}

function getMessageSources(msg: ChatMessage): PlanChatSource[] | undefined {
  const sources = msg.metadata?.sources;
  if (!Array.isArray(sources)) return undefined;
  return sources.filter(
    (s): s is PlanChatSource =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as PlanChatSource).url === "string",
  );
}

async function parsePlanNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
): Promise<{ full: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const evt = JSON.parse(trimmed) as {
      type?: string;
      text?: string;
      error?: string;
    };
    if (evt.type === "chunk" && evt.text) {
      full += evt.text;
      onChunk(full);
    } else if (evt.type === "error") {
      throw new Error(evt.error || "Stream error");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      processLine(line);
    }
  }
  if (buffer.trim()) {
    processLine(buffer);
  }

  return { full };
}

async function readStreamError(res: Response): Promise<string> {
  const text = await res.text();
  const firstLine = text.split("\n").find((l) => l.trim());
  if (firstLine) {
    try {
      const evt = JSON.parse(firstLine) as { error?: string };
      if (evt.error) return evt.error;
    } catch {
      /* fall through */
    }
  }
  return `Request failed (${res.status})`;
}

const PRODUCTIQ_EXAMPLES = [
  "Find products under $500",
  "Compare available options",
  "Show products by manufacturer",
  "Margin on SKU ABC-123",
];

const PlanModePanel = forwardRef<ModeChatPanelHandle, PlanModePanelProps>(
  function PlanModePanel({ projectId, activeSpreadsheetId = null }, ref) {
    const supabase = createClient();
    const scrollRef = useRef<HTMLDivElement>(null);

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(true);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [streamingText, setStreamingText] = useState("");
    const [error, setError] = useState<string | null>(null);

    const scrollToLatest = () => {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      });
    };

    const loadMessages = useCallback(async () => {
      setLoadingMessages(true);
      const { data, error: loadError } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(100);

      if (loadError) {
        setError(loadError.message);
        setLoadingMessages(false);
        return;
      }

      const planMessages = (data ?? []).filter(isPlanMessage) as ChatMessage[];
      setMessages(planMessages);
      setLoadingMessages(false);
    }, [projectId, supabase]);

    useEffect(() => {
      void loadMessages();
    }, [loadMessages]);

    const persistMessage = async (
      role: "user" | "assistant",
      content: string,
      extraMetadata?: Record<string, unknown>,
    ) => {
      const { data, error: insertError } = await supabase
        .from("chat_messages")
        .insert({
          project_id: projectId,
          role,
          content,
          metadata: { mode: "plan", ...extraMetadata },
        })
        .select()
        .single();

      if (insertError) throw insertError;
      if (data) {
        setMessages((prev) => [...prev, data as ChatMessage]);
      }
      return data as ChatMessage;
    };

    const sendMessage = async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || busy) return;

      setBusy(true);
      setError(null);
      setInput("");
      setStreamingText("");

      try {
        await persistMessage("user", text);
        scrollToLatest();

        const history = messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        const res = await fetch("/api/ai/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            activeSpreadsheetId,
            message: text,
            history,
          }),
        });

        if (!res.ok) {
          throw new Error(await readStreamError(res));
        }

        if (!res.body) throw new Error("No response stream");

        const { full } = await parsePlanNdjsonStream(res.body, (chunk) => {
          setStreamingText(chunk);
          scrollToLatest();
        });

        setStreamingText("");
        await persistMessage("assistant", full);
        await trackAIChatMessage(projectId, text.length);
        scrollToLatest();
      } catch (e) {
        setStreamingText("");
        setError(e instanceof Error ? e.message : "Failed to send");
        setInput(text);
      } finally {
        setBusy(false);
      }
    };

    const clearPlanChat = async () => {
      if (!confirm("Clear Price Book Copilot conversation for this project?")) return;
      setBusy(true);
      try {
        const ids = messages.map((m) => m.id);
        if (ids.length > 0) {
          await supabase.from("chat_messages").delete().in("id", ids);
        }
        setMessages([]);
        setStreamingText("");
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to clear");
      } finally {
        setBusy(false);
      }
    };

    useImperativeHandle(ref, () => ({
      clearChat: clearPlanChat,
    }));

    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {!loadingMessages && messages.length === 0 && !streamingText && !busy && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center space-y-3">
              <p className="text-sm font-medium text-gray-900">ProductIQ</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                AI-powered search across your products, pricing, inventory and margins
              </p>
              <ul className="text-xs text-gray-800 text-left inline-block space-y-1.5 pt-1 list-disc pl-5 font-semibold">
                {PRODUCTIQ_EXAMPLES.map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ul>
            </div>
          )}

          {messages.map((msg) => (
            <ScopeMessageBubble
              key={msg.id}
              role={msg.role as "user" | "assistant"}
              content={msg.content}
              sources={msg.role === "assistant" ? getMessageSources(msg) : undefined}
            />
          ))}

          {streamingText && (
            <ScopeMessageBubble role="assistant" content={streamingText} />
          )}

          {busy && !streamingText && (
            <p className="text-xs text-gray-500 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Searching price book…
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-200 p-3 space-y-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            rows={2}
            placeholder="Search your product catalog with natural language..."
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-green-500"
            disabled={busy}
          />
          <div className="flex justify-end items-center gap-2">
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={busy || !input.trim()}
              title={!input.trim() ? "Enter a message to send" : undefined}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-green-700 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-50"
            >
              <Send size={14} />
              Send
            </button>
          </div>
        </div>
      </div>
    );
  },
);

export default PlanModePanel;
