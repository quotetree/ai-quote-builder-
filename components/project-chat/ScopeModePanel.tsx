"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Loader2, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage } from "@/types/database";
import {
  formatScopeAnswersForDisplay,
  getDefaultScopeAnswers,
  scopeAnswersToApiPayload,
  type ScopeAnswersState,
} from "@/lib/ai/scopeQuestionnaire";
import ScopeQuestionnaire from "./ScopeQuestionnaire";
import ScopeMessageBubble from "./ScopeMessageBubble";
import { trackAIChatMessage } from "@/lib/analytics";
import type { ModeChatPanelHandle } from "./PlanModePanel";

type ScopeUiPhase = "idle" | "questions" | "generating" | "refine";

interface ScopeModePanelProps {
  projectId: string;
  activeSpreadsheetId?: string | null;
}

function isScopeMessage(msg: ChatMessage): boolean {
  return msg.metadata?.mode === "scope";
}

const ScopeModePanel = forwardRef<ModeChatPanelHandle, ScopeModePanelProps>(
  function ScopeModePanel({ projectId, activeSpreadsheetId = null }, ref) {
  const supabase = createClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [uiPhase, setUiPhase] = useState<ScopeUiPhase>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [scopeAnswers, setScopeAnswers] = useState<ScopeAnswersState>(getDefaultScopeAnswers);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollToLatestMessage = () => {
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

    const scopeOnly = (data ?? []).filter(isScopeMessage) as ChatMessage[];
    setMessages(scopeOnly);
    if (scopeOnly.some((m) => m.metadata?.phase === "generate")) {
      setUiPhase("refine");
    } else {
      setUiPhase("idle");
    }
    setLoadingMessages(false);
  }, [projectId, supabase]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const persistMessage = async (
    role: "user" | "assistant",
    content: string,
    metadata: Record<string, unknown>,
  ) => {
    const { data, error: insertError } = await supabase
      .from("chat_messages")
      .insert({
        project_id: projectId,
        role,
        content,
        metadata: { mode: "scope", ...metadata },
      })
      .select()
      .single();

    if (insertError) throw insertError;
    if (data) setMessages((prev) => [...prev, data as ChatMessage]);
    return data as ChatMessage;
  };

  const startQuestionnaire = () => {
    setScopeAnswers(getDefaultScopeAnswers());
    setUiPhase("questions");
    setError(null);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  };

  const submitAnswers = async () => {
    setBusy(true);
    setError(null);
    setUiPhase("generating");
    try {
      const apiAnswers = scopeAnswersToApiPayload(scopeAnswers);
      apiAnswers.generate_section_ids = scopeAnswers.generate_sections.join(",");
      apiAnswers.generate_other = scopeAnswers.generate_other.trim();

      const userSummary = formatScopeAnswersForDisplay(scopeAnswers);
      await persistMessage("user", userSummary, {
        phase: "questions",
        answers: apiAnswers,
        scopeAnswers,
      });

      const res = await fetch("/api/ai/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          activeSpreadsheetId,
          phase: "generate",
          answers: apiAnswers,
          generateSectionIds: scopeAnswers.generate_sections.join(","),
          generateOther: scopeAnswers.generate_other.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate");

      await persistMessage("assistant", data.content, { phase: "generate" });
      setUiPhase("refine");
      scrollToLatestMessage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
      setUiPhase("questions");
    } finally {
      setBusy(false);
    }
  };

  const sendRefinement = async () => {
    const text = input.trim();
    if (!text || busy) return;

    setBusy(true);
    setError(null);
    setInput("");
    try {
      await persistMessage("user", text, { phase: "refine" });

      const history = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const res = await fetch("/api/ai/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          activeSpreadsheetId,
          phase: "refine",
          message: text,
          history,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to refine");

      await persistMessage("assistant", data.content, { phase: "refine" });
      scrollToLatestMessage();
      await trackAIChatMessage(projectId, text.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
      setInput(text);
    } finally {
      setBusy(false);
    }
  };

  const clearScopeChat = async () => {
    if (!confirm("Clear Scope conversation for this project?")) return;
    setBusy(true);
    try {
      const ids = messages.map((m) => m.id);
      if (ids.length > 0) {
        await supabase.from("chat_messages").delete().in("id", ids);
      }
      setMessages([]);
      setScopeAnswers(getDefaultScopeAnswers());
      setUiPhase("idle");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear");
    } finally {
      setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({
    clearChat: clearScopeChat,
  }));

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loadingMessages && (
          <p className="text-xs text-gray-500 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading conversation…
          </p>
        )}

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        {messages.map((msg) => (
          <ScopeMessageBubble key={msg.id} role={msg.role as "user" | "assistant"} content={msg.content} />
        ))}

        {uiPhase === "idle" && !loadingMessages && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
            <p className="text-sm font-medium text-gray-900 mb-2">Scope proposal writer</p>
            <p className="text-xs text-gray-600 mb-4 leading-relaxed">
              Answer four quick questions, then get scope of work, exclusions, assumptions, or a project summary from your quote—without changing pricing.
            </p>
            <button
              type="button"
              onClick={startQuestionnaire}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Start scope draft
            </button>
          </div>
        )}

        {uiPhase === "questions" && (
          <ScopeQuestionnaire
            answers={scopeAnswers}
            onChange={setScopeAnswers}
            onSubmit={() => void submitAnswers()}
            submitting={busy}
          />
        )}

        {uiPhase === "generating" && (
          <p className="text-xs text-gray-500 flex items-center gap-2 justify-center py-8">
            <Loader2 size={16} className="animate-spin" />
            Writing proposal sections…
          </p>
        )}
      </div>

      {(uiPhase === "refine" || (messages.some((m) => m.metadata?.phase === "generate") && uiPhase !== "questions" && uiPhase !== "idle")) && (
        <div className="shrink-0 border-t border-gray-200 p-3 space-y-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendRefinement();
              }
            }}
            rows={2}
            placeholder="Refine: e.g. Add bullets, make shorter, add exclusion for roof access…"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-green-500"
            disabled={busy}
          />
          <div className="flex justify-end items-center gap-2">
            <button
              type="button"
              onClick={() => void sendRefinement()}
              disabled={busy || !input.trim()}
              className="px-4 py-1.5 rounded-lg bg-green-700 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-50"
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
},
);

export default ScopeModePanel;
