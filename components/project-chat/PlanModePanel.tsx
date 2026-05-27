"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Loader2, Send, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type {
  ChatMessage,
  PlanChatSource,
  PlanDocumentCitation,
} from "@/types/database";
import {
  buildPlanPdfStoragePath,
  validatePlanUpload,
} from "@/lib/ai/planFileValidation";
import ScopeMessageBubble from "./ScopeMessageBubble";
import PlanAttachmentChips, {
  type PlanAttachmentChip,
} from "./PlanAttachmentChips";
import type { MessageAttachmentMeta } from "./MessageAttachmentList";
import { trackAIChatMessage } from "@/lib/analytics";

export interface ModeChatPanelHandle {
  clearChat: () => Promise<void>;
}

interface PlanModePanelProps {
  projectId: string;
  activeSpreadsheetId?: string | null;
}

const FILE_ACCEPT =
  "application/pdf,image/*,text/csv,.csv,application/vnd.ms-excel";

function isPlanMessage(msg: ChatMessage): boolean {
  return msg.metadata?.mode === "plan";
}

function resolveMessageAttachments(
  msg: ChatMessage,
  cache: Record<string, MessageAttachmentMeta>,
): MessageAttachmentMeta[] | undefined {
  const ids = msg.metadata?.attachment_ids;
  const idList = Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];

  const snapshot = msg.metadata?.attachments;
  const fromSnapshot = Array.isArray(snapshot)
    ? snapshot
        .filter(
          (a): a is MessageAttachmentMeta =>
            typeof a === "object" &&
            a !== null &&
            typeof (a as MessageAttachmentMeta).id === "string" &&
            typeof (a as MessageAttachmentMeta).file_name === "string",
        )
        .map((a) => {
          const cached = cache[a.id];
          return {
            id: a.id,
            file_name: a.file_name,
            mime_type:
              typeof a.mime_type === "string"
                ? a.mime_type
                : cached?.mime_type ?? "application/octet-stream",
            storage_path: cached?.storage_path,
          };
        })
    : [];

  if (fromSnapshot.length > 0) return fromSnapshot;

  if (idList.length === 0) return undefined;

  return idList
    .map((id) => cache[id])
    .filter((a): a is MessageAttachmentMeta => !!a);
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

function getMessageDocumentCitations(
  msg: ChatMessage,
): PlanDocumentCitation[] | undefined {
  const raw = msg.metadata?.document_citations;
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(
    (c): c is PlanDocumentCitation =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as PlanDocumentCitation).fileName === "string" &&
      typeof (c as PlanDocumentCitation).pageStart === "number" &&
      typeof (c as PlanDocumentCitation).pageEnd === "number",
  );
}

async function parsePlanNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
): Promise<{
  full: string;
  sources: PlanChatSource[];
  documentCitations: PlanDocumentCitation[];
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let sources: PlanChatSource[] = [];
  let documentCitations: PlanDocumentCitation[] = [];

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const evt = JSON.parse(trimmed) as {
      type?: string;
      text?: string;
      sources?: PlanChatSource[];
      documentCitations?: PlanDocumentCitation[];
      error?: string;
    };
    if (evt.type === "chunk" && evt.text) {
      full += evt.text;
      onChunk(full);
    } else if (evt.type === "done") {
      sources = evt.sources ?? [];
      documentCitations = evt.documentCitations ?? [];
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

  return { full, sources, documentCitations };
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

const PlanModePanel = forwardRef<ModeChatPanelHandle, PlanModePanelProps>(
  function PlanModePanel({ projectId, activeSpreadsheetId = null }, ref) {
  const supabase = createClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingSources, setStreamingSources] = useState<PlanChatSource[]>([]);
  const [streamingDocumentCitations, setStreamingDocumentCitations] = useState<
    PlanDocumentCitation[]
  >([]);
  const [pendingAttachments, setPendingAttachments] = useState<PlanAttachmentChip[]>([]);
  const pendingAttachmentsRef = useRef<PlanAttachmentChip[]>([]);
  const [attachmentCache, setAttachmentCache] = useState<Record<string, MessageAttachmentMeta>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  const loadAttachmentCache = useCallback(
    async (msgs: ChatMessage[]) => {
      const ids = new Set<string>();
      for (const msg of msgs) {
        const raw = msg.metadata?.attachment_ids;
        if (Array.isArray(raw)) {
          for (const id of raw) {
            if (typeof id === "string") ids.add(id);
          }
        }
      }
      if (ids.size === 0) {
        setAttachmentCache({});
        return;
      }

      const { data } = await supabase
        .from("chat_attachments")
        .select("id, file_name, mime_type, storage_path")
        .in("id", [...ids]);

      const map: Record<string, MessageAttachmentMeta> = {};
      for (const row of data ?? []) {
        map[row.id] = {
          id: row.id,
          file_name: row.file_name,
          mime_type: row.mime_type,
          storage_path: row.storage_path,
        };
      }
      setAttachmentCache(map);
    },
    [supabase],
  );

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
    await loadAttachmentCache(planMessages);
    setLoadingMessages(false);
  }, [projectId, supabase, loadAttachmentCache]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const updateAttachment = useCallback(
    (clientId: string, patch: Partial<PlanAttachmentChip>) => {
      setPendingAttachments((prev) =>
        prev.map((att) => (att.clientId === clientId ? { ...att, ...patch } : att)),
      );
    },
    [],
  );

  const pollDocumentStatus = useCallback(
    async (clientId: string, attachmentId: string) => {
      updateAttachment(clientId, { phase: "processing", parse_error: null });

      const deadline = Date.now() + 10 * 60 * 1000;
      const startedAt = Date.now();
      let longWaitNotified = false;

      while (Date.now() < deadline) {
        const res = await fetch(
          `/api/ai/documents/status?attachmentId=${encodeURIComponent(attachmentId)}`,
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error ?? "Could not check document status");
        }

        const status = body.processingStatus as string;
        if (status === "ready") {
          updateAttachment(clientId, {
            phase: "ready",
            parse_error: null,
          });
          return;
        }
        if (status === "failed") {
          throw new Error(
            body.parseError ??
              "Document processing failed. Try again or use a different PDF.",
          );
        }

        // pending / processing — keep UI in sync until truly ready
        updateAttachment(clientId, { phase: "processing" });

        if (!longWaitNotified && Date.now() - startedAt > 2 * 60 * 1000) {
          longWaitNotified = true;
          setError((prev) =>
            prev ??
              "Large documents can take several minutes to process. You can keep waiting or ask questions once Ready appears.",
          );
        }

        await new Promise((r) => setTimeout(r, 2000));
      }

      throw new Error(
        "Document processing is taking longer than expected. Try Retry or check back shortly.",
      );
    },
    [updateAttachment],
  );

  const uploadPdfFile = useCallback(
    async (clientId: string, file: File) => {
      updateAttachment(clientId, { phase: "uploading" });
      const storagePath = buildPlanPdfStoragePath(projectId, file.name);
      const mimeType = file.type || "application/pdf";

      const { error: uploadError } = await supabase.storage
        .from("project-files")
        .upload(storagePath, file, {
          contentType: mimeType,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const res = await fetch("/api/ai/documents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          storagePath,
          fileName: file.name,
          mimeType,
          fileSize: file.size,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `Registration failed (${res.status})`);
      }

      const attachment = body.attachment as {
        id: string;
        file_name: string;
        mime_type: string;
      };
      const documentId = body.documentId as string;

      if (!attachment?.id) {
        throw new Error("Upload succeeded but no attachment id returned");
      }

      updateAttachment(clientId, {
        serverId: attachment.id,
        documentId,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        phase: "processing",
      });

      await pollDocumentStatus(clientId, attachment.id);
    },
    [projectId, supabase, updateAttachment, pollDocumentStatus],
  );

  const uploadLegacyFile = useCallback(
    async (clientId: string, file: File) => {
      updateAttachment(clientId, { phase: "uploading" });

      const formData = new FormData();
      formData.append("projectId", projectId);
      formData.append("file", file);

      const res = await fetch("/api/ai/attachments", {
        method: "POST",
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body.error ||
            (res.status === 413
              ? `${file.name} is too large (max 20MB)`
              : `Upload failed (${res.status})`),
        );
      }

      const row = body.attachment as {
        id: string;
        file_name: string;
        mime_type: string;
        parse_status: string;
        parse_error?: string | null;
      };

      if (!row?.id) throw new Error("Upload succeeded but no attachment id returned");

      updateAttachment(clientId, {
        serverId: row.id,
        file_name: row.file_name,
        mime_type: row.mime_type,
        phase: row.parse_status === "error" ? "error" : "ready",
        parse_error: row.parse_error,
      });
    },
    [projectId, updateAttachment],
  );

  const uploadOneFile = useCallback(
    async (clientId: string, file: File, isPdfHint?: boolean) => {
      updateAttachment(clientId, { phase: "uploading" });

      const validation = validatePlanUpload(file);
      if (!validation.ok) {
        updateAttachment(clientId, {
          phase: "error",
          parse_error: validation.error,
        });
        setError((prev) => {
          const msg = validation.error ?? "Invalid file";
          return prev ? `${prev} ${msg}` : msg;
        });
        return;
      }

      try {
        const usePdfPipeline =
          validation.route === "pdf_pipeline" || isPdfHint === true;
        if (usePdfPipeline) {
          await uploadPdfFile(clientId, file);
        } else {
          await uploadLegacyFile(clientId, file);
        }
      } catch (e) {
        updateAttachment(clientId, {
          phase: "error",
          parse_error: e instanceof Error ? e.message : "Upload failed",
        });
        setError((prev) => {
          const msg = e instanceof Error ? e.message : "Upload failed";
          return prev ? `${prev} ${msg}` : msg;
        });
      }
    },
    [uploadPdfFile, uploadLegacyFile, updateAttachment],
  );

  const retryAttachmentProcessing = useCallback(
    async (clientId: string) => {
      const att = pendingAttachmentsRef.current.find((a) => a.clientId === clientId);
      if (!att?.documentId || !att.serverId) return;

      updateAttachment(clientId, { phase: "processing", parse_error: null });
      setError(null);

      try {
        const res = await fetch("/api/ai/documents/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            documentId: att.documentId,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error ?? "Retry failed");
        }
        await pollDocumentStatus(clientId, att.serverId);
      } catch (e) {
        updateAttachment(clientId, {
          phase: "error",
          parse_error: e instanceof Error ? e.message : "Retry failed",
        });
      }
    },
    [projectId, pollDocumentStatus, updateAttachment],
  );

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
      const row = data as ChatMessage;
      setMessages((prev) => {
        const next = [...prev, row];
        void loadAttachmentCache(next);
        return next;
      });
    }
    return data as ChatMessage;
  };

  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const issues: string[] = [];
    const newItems: PlanAttachmentChip[] = [];

    for (const file of list) {
      const validation = validatePlanUpload(file);
      if (!validation.ok) {
        issues.push(validation.error ?? `${file.name} is not supported`);
        continue;
      }

      const clientId = crypto.randomUUID();
      const previewUrl = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined;

      const isPdf =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

      newItems.push({
        clientId,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        previewUrl,
        phase: "uploading",
      });

      void uploadOneFile(clientId, file, isPdf);
    }

    if (newItems.length > 0) {
      setPendingAttachments((prev) => [...prev, ...newItems]);
    }
    if (issues.length > 0) {
      setError(issues.join(" "));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (clientId: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((a) => a.clientId === clientId);
      if (target?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((a) => a.clientId !== clientId);
    });
  };

  const attachmentsNotReady = pendingAttachments.some(
    (a) => a.phase !== "ready" || !a.serverId,
  );

  const waitForAttachmentsReady = async (
    clientIds: string[],
    timeoutMs = 30_000,
  ): Promise<string[]> => {
    if (clientIds.length === 0) return [];

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const tracked = pendingAttachmentsRef.current.filter((a) =>
        clientIds.includes(a.clientId),
      );
      const failed = tracked.find((a) => a.phase === "error");
      if (failed) {
        throw new Error(failed.parse_error ?? `Upload failed for ${failed.file_name}`);
      }

      if (
        tracked.length === clientIds.length &&
        tracked.every((a) => a.serverId && a.phase === "ready")
      ) {
        return tracked.map((a) => a.serverId!);
      }

      await new Promise((r) => setTimeout(r, 250));
    }

    throw new Error("Files are still uploading or processing. Wait until Ready and try again.");
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || busy) return;

    const sentAttachments = [...pendingAttachments];
    const uploadClientIds = sentAttachments.map((a) => a.clientId);

    setBusy(true);
    setError(null);
    setInput("");
    setStreamingText("");
    setStreamingSources([]);
    setStreamingDocumentCitations([]);

    try {
      let attachmentIds: string[] = [];
      if (uploadClientIds.length > 0) {
        attachmentIds = await waitForAttachmentsReady(uploadClientIds);
      }

      setPendingAttachments([]);

      let attachmentSnapshot: MessageAttachmentMeta[] = [];
      if (attachmentIds.length > 0) {
        const { data: rows } = await supabase
          .from("chat_attachments")
          .select("id, file_name, mime_type, storage_path")
          .in("id", attachmentIds);
        attachmentSnapshot = (rows ?? []).map((row) => ({
          id: row.id,
          file_name: row.file_name,
          mime_type: row.mime_type,
          storage_path: row.storage_path,
        }));
      }

      if (attachmentSnapshot.length > 0) {
        setAttachmentCache((prev) => {
          const next = { ...prev };
          for (const att of attachmentSnapshot) next[att.id] = att;
          return next;
        });
      }

      await persistMessage("user", text, {
        attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
        attachments: attachmentSnapshot.length > 0 ? attachmentSnapshot : undefined,
      });
      scrollToLatest();

      const history = [
        ...messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: text },
      ];

      const res = await fetch("/api/ai/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          activeSpreadsheetId,
          message: text,
          history,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(await readStreamError(res));
      }

      if (!res.body) throw new Error("No response stream");

      const { full, sources, documentCitations } = await parsePlanNdjsonStream(
        res.body,
        (chunk) => {
          setStreamingText(chunk);
          scrollToLatest();
        },
      );

      setStreamingText("");
      setStreamingSources(sources);
      setStreamingDocumentCitations(documentCitations);
      await persistMessage("assistant", full, {
        sources: sources.length > 0 ? sources : undefined,
        document_citations:
          documentCitations.length > 0 ? documentCitations : undefined,
      });
      setStreamingSources([]);
      setStreamingDocumentCitations([]);
      await trackAIChatMessage(projectId, text.length);
      scrollToLatest();

    } catch (e) {
      setStreamingText("");
      setStreamingSources([]);
      setError(e instanceof Error ? e.message : "Failed to send");
      setInput(text);
      setPendingAttachments(sentAttachments);
    } finally {
      setBusy(false);
    }
  };

  const clearPlanChat = async () => {
    if (!confirm("Clear Plan conversation for this project?")) return;
    setBusy(true);
    try {
      const ids = messages.map((m) => m.id);
      if (ids.length > 0) {
        await supabase.from("chat_messages").delete().in("id", ids);
      }
      setMessages([]);
      setStreamingText("");
      setStreamingSources([]);
      pendingAttachments.forEach((att) => {
        if (att.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(att.previewUrl);
      });
      setPendingAttachments([]);
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
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center">
            <p className="text-sm font-medium text-gray-900 mb-1">Plan assistant</p>
            <p className="text-xs text-gray-600 leading-relaxed">
              Ask about your quote, bid strategy, scope ideas, or competitor comparisons. Attach PDFs,
              images, or CSVs. Web search runs when Tavily is configured.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <ScopeMessageBubble
            key={msg.id}
            role={msg.role as "user" | "assistant"}
            content={msg.content}
            attachments={
              msg.role === "user"
                ? resolveMessageAttachments(msg, attachmentCache)
                : undefined
            }
            sources={
              msg.role === "assistant" ? getMessageSources(msg) : undefined
            }
            documentCitations={
              msg.role === "assistant" ? getMessageDocumentCitations(msg) : undefined
            }
          />
        ))}

        {streamingText && (
          <ScopeMessageBubble
            role="assistant"
            content={streamingText}
            sources={streamingSources.length > 0 ? streamingSources : undefined}
            documentCitations={
              streamingDocumentCitations.length > 0
                ? streamingDocumentCitations
                : undefined
            }
          />
        )}

        {busy && !streamingText && (
          <p className="text-xs text-gray-500 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Thinking…
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-gray-200 p-3 space-y-2">
        <PlanAttachmentChips
          attachments={pendingAttachments}
          onRemove={removeAttachment}
          onRetry={(id) => void retryAttachmentProcessing(id)}
        />

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
          placeholder="Ask about the quote, bid strategy, scope, labor breakdown…"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-green-500"
          disabled={busy}
        />
        <div className="flex justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={FILE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1 disabled:opacity-50"
              title="Attach PDF, image, or CSV"
            >
              <Paperclip size={12} />
              Attach
            </button>
          </div>
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={busy || !input.trim() || attachmentsNotReady}
            title={
              attachmentsNotReady
                ? "Wait until every attachment shows Ready (green) before sending"
                : !input.trim()
                  ? "Enter a message to send"
                  : undefined
            }
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
