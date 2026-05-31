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
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage } from "@/types/database";
import type {
  BuildApiResponse,
  BuildMatchCard,
  BuildSpreadsheetContext,
  BuildUpdateResponse,
} from "@/lib/ai/buildTypes";
import type { BuildUpdateProposal } from "@/lib/applyBuildUpdates";
import { applyBuildUpdateProposals } from "@/lib/applyBuildUpdates";
import {
  buildRowFromInput,
  computeSpreadsheetTotals,
  defaultSectionId,
  emptySection,
  placeRowInSpreadsheet,
} from "@/lib/spreadsheetLineItems";
import { buildSpreadsheetContext, normalizeSpreadsheetContext } from "@/lib/buildSpreadsheetContext";
import type { ProjectSpreadsheet, SpreadsheetSection } from "@/types/database";
import { useProducts } from "@/hooks/useProducts";
import ScopeMessageBubble from "./ScopeMessageBubble";
import BuildMatchCardComponent, { type BuildAddPayload } from "./BuildMatchCard";
import BuildUpdateCard from "./BuildUpdateCard";
import { trackAIChatMessage } from "@/lib/analytics";
import type { ModeChatPanelHandle } from "./PlanModePanel";

interface BuildModePanelProps {
  projectId: string;
  activeSpreadsheetId?: string | null;
}

function isBuildMessage(msg: ChatMessage): boolean {
  return msg.metadata?.mode === "build";
}

function parseCards(msg: ChatMessage): BuildMatchCard[] {
  const cards = msg.metadata?.cards;
  if (!Array.isArray(cards)) return [];
  return cards as BuildMatchCard[];
}

function parseUpdateProposals(msg: ChatMessage): BuildUpdateProposal[] {
  const proposals = msg.metadata?.updateProposals;
  if (!Array.isArray(proposals)) return [];
  return proposals as BuildUpdateProposal[];
}

function parseSpreadsheetContext(msg: ChatMessage): BuildSpreadsheetContext | undefined {
  const ctx = msg.metadata?.spreadsheetContext;
  if (!ctx || typeof ctx !== "object") return undefined;
  return normalizeSpreadsheetContext(ctx as BuildSpreadsheetContext & { isNonBlank?: boolean });
}

const EXAMPLE_PROMPTS = [
  "10 Verkada 1yr licenses, 5 bullet cameras, 5 CD53s, 3 boxes of cable, $8,800 camera labor",
  "I need a four-door access controller at a 10% discount",
  "Add 10% discount to all items in the Equipment section",
];

const BuildModePanel = forwardRef<ModeChatPanelHandle, BuildModePanelProps>(
  function BuildModePanel({ projectId, activeSpreadsheetId = null }, ref) {
    const supabase = createClient();
    const { products, loading: productsLoading } = useProducts();
    const scrollRef = useRef<HTMLDivElement>(null);

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(true);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [addedItemIds, setAddedItemIds] = useState<Set<string>>(new Set());
    const [addingItemId, setAddingItemId] = useState<string | null>(null);
    const [appliedProposalIds, setAppliedProposalIds] = useState<Set<string>>(new Set());
    const [applyingProposalId, setApplyingProposalId] = useState<string | null>(null);
    const [liveSpreadsheetContext, setLiveSpreadsheetContext] =
      useState<BuildSpreadsheetContext | null>(null);
    const [localSpreadsheetId, setLocalSpreadsheetId] = useState<string | null>(null);

    const effectiveSpreadsheetId = activeSpreadsheetId ?? localSpreadsheetId;

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

      const buildMessages = (data ?? []).filter(isBuildMessage) as ChatMessage[];
      setMessages(buildMessages);
      setLoadingMessages(false);
    }, [projectId, supabase]);

    useEffect(() => {
      void loadMessages();
    }, [loadMessages]);

    useEffect(() => {
      if (activeSpreadsheetId) {
        setLocalSpreadsheetId(activeSpreadsheetId);
      }
    }, [activeSpreadsheetId]);

    useEffect(() => {
      if (!effectiveSpreadsheetId) {
        setLiveSpreadsheetContext(null);
        return;
      }
      void (async () => {
        const { data } = await supabase
          .from("project_spreadsheets")
          .select("id, title, sections, template_id")
          .eq("id", effectiveSpreadsheetId)
          .eq("project_id", projectId)
          .maybeSingle();
        if (!data) return;
        const sections = (data.sections ?? []) as SpreadsheetSection[];
        setLiveSpreadsheetContext(
          buildSpreadsheetContext(
            data.id,
            data.title || "Untitled Spreadsheet",
            sections,
            data.template_id as string | null,
          ),
        );
      })();
    }, [effectiveSpreadsheetId, projectId, supabase]);

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
          metadata: { mode: "build", ...extraMetadata },
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
      setAddedItemIds(new Set());
      setAppliedProposalIds(new Set());

      try {
        await persistMessage("user", text);
        scrollToLatest();

        const res = await fetch("/api/ai/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            activeSpreadsheetId: effectiveSpreadsheetId,
            phase: "auto",
            message: text,
          }),
        });

        const body = (await res.json()) as BuildApiResponse & { error?: string };
        if (!res.ok) {
          throw new Error(body.error || `Request failed (${res.status})`);
        }

        if (body.kind === "update") {
          await persistMessage("assistant", body.summary, {
            buildUpdate: true,
            updatesApplied: body.updatesApplied,
            spreadsheetContext: body.spreadsheetContext,
          });
        } else if (body.kind === "parse") {
          const ctx = body.spreadsheetContext ?? liveSpreadsheetContext ?? undefined;
          await persistMessage("assistant", body.summary, {
            cards: body.cards,
            updateProposals: body.updateProposals,
            spreadsheetContext: ctx,
          });
        }

        await trackAIChatMessage(projectId, text.length);
        scrollToLatest();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to send");
        setInput(text);
      } finally {
        setBusy(false);
      }
    };

    const ensureSpreadsheet = async (): Promise<{ id: string; sections: SpreadsheetSection[] }> => {
      if (effectiveSpreadsheetId) {
        const { data, error: fetchError } = await supabase
          .from("project_spreadsheets")
          .select("id, sections")
          .eq("id", effectiveSpreadsheetId)
          .eq("project_id", projectId)
          .maybeSingle();
        if (fetchError) throw fetchError;
        if (data) {
          return {
            id: data.id,
            sections: (data.sections ?? []) as SpreadsheetSection[],
          };
        }
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const title = `Build — ${new Date().toLocaleDateString()}`;
      const initialSections = [emptySection("Line Items")];
      const { data, error: insertError } = await supabase
        .from("project_spreadsheets")
        .insert({
          project_id: projectId,
          user_id: user.id,
          folder_id: null,
          title,
          template_id: null,
          sections: initialSections,
          charges: [],
          baked_markups: [],
          subtotal: 0,
          total: 0,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      const sheet = data as ProjectSpreadsheet;
      setLocalSpreadsheetId(sheet.id);

      window.dispatchEvent(
        new CustomEvent("buildSpreadsheetOpened", {
          detail: { spreadsheet: sheet, projectId },
        }),
      );

      return { id: sheet.id, sections: initialSections };
    };

    const handleApplyUpdate = async (proposal: BuildUpdateProposal) => {
      if (!effectiveSpreadsheetId) {
        toast.error("Open a spreadsheet first");
        return;
      }

      setApplyingProposalId(proposal.proposalId);
      try {
        const { data, error: fetchError } = await supabase
          .from("project_spreadsheets")
          .select("id, title, sections, template_id")
          .eq("id", effectiveSpreadsheetId)
          .eq("project_id", projectId)
          .maybeSingle();

        if (fetchError) throw fetchError;
        if (!data) throw new Error("Spreadsheet not found");

        const currentSections = (data.sections ?? []) as SpreadsheetSection[];
        const { sections: updatedSections, applied } = applyBuildUpdateProposals(
          currentSections,
          [proposal],
        );
        if (applied.length === 0) {
          throw new Error("Could not apply that change — the row may have changed");
        }

        const { subtotal, total } = computeSpreadsheetTotals(updatedSections);
        const { data: saved, error: updateError } = await supabase
          .from("project_spreadsheets")
          .update({ sections: updatedSections, subtotal, total })
          .eq("id", effectiveSpreadsheetId)
          .select("id, title, sections, template_id")
          .single();

        if (updateError) throw updateError;

        window.dispatchEvent(
          new CustomEvent("spreadsheetLineItemAdded", {
            detail: {
              spreadsheetId: effectiveSpreadsheetId,
              sections: updatedSections,
              subtotal,
              total,
              spreadsheet: saved as ProjectSpreadsheet,
            },
          }),
        );

        if (saved) {
          setLiveSpreadsheetContext(
            buildSpreadsheetContext(
              saved.id,
              saved.title || "Untitled Spreadsheet",
              (saved.sections ?? []) as SpreadsheetSection[],
              saved.template_id as string | null,
            ),
          );
        }

        setAppliedProposalIds((prev) => new Set(prev).add(proposal.proposalId));
        toast.success(`Updated ${proposal.productName}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to apply change");
      } finally {
        setApplyingProposalId(null);
      }
    };

    const handleAddToQuote = async (payload: BuildAddPayload) => {
      setAddingItemId(payload.itemId);
      try {
        const { id: spreadsheetId, sections: currentSections } = await ensureSpreadsheet();

        let targetSectionId = payload.sectionId ?? defaultSectionId(currentSections);
        if (!targetSectionId && !payload.createNewSection) {
          throw new Error("No section available on spreadsheet");
        }

        const row = buildRowFromInput({
          productId: payload.productId,
          productName: payload.productName,
          productCode: payload.productCode,
          listPrice: payload.listPrice,
          salesPrice: payload.salesPrice,
          quantity: payload.quantity,
          discount: payload.discount,
          customLabel: "",
        });

        let workingSections = currentSections;
        if (payload.createNewSection) {
          workingSections = [...currentSections, emptySection("Untitled section")];
          targetSectionId = workingSections[workingSections.length - 1].id;
        }

        const updatedSections = placeRowInSpreadsheet(workingSections, {
          sectionId: targetSectionId!,
          rowId: payload.rowId,
          createNewSection: false,
          createNewRow: payload.createNewRow,
          row,
        });
        const { subtotal, total } = computeSpreadsheetTotals(updatedSections);

        const { data, error: updateError } = await supabase
          .from("project_spreadsheets")
          .update({ sections: updatedSections, subtotal, total })
          .eq("id", spreadsheetId)
          .select("id, title, sections, template_id")
          .single();

        if (updateError) throw updateError;

        window.dispatchEvent(
          new CustomEvent("spreadsheetLineItemAdded", {
            detail: {
              spreadsheetId,
              sections: updatedSections,
              subtotal,
              total,
              spreadsheet: data as ProjectSpreadsheet,
            },
          }),
        );

        setAddedItemIds((prev) => new Set(prev).add(payload.itemId));
        if (data) {
          setLiveSpreadsheetContext(
            buildSpreadsheetContext(
              data.id,
              data.title || "Untitled Spreadsheet",
              (data.sections ?? []) as SpreadsheetSection[],
              data.template_id as string | null,
            ),
          );
        }
        toast.success(`Added "${payload.productName}" to spreadsheet`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to add to quote");
      } finally {
        setAddingItemId(null);
      }
    };

    const clearBuildChat = async () => {
      if (!confirm("Clear Build conversation for this project?")) return;
      setBusy(true);
      try {
        const ids = messages.map((m) => m.id);
        if (ids.length > 0) {
          await supabase.from("chat_messages").delete().in("id", ids);
        }
        setMessages([]);
        setAddedItemIds(new Set());
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to clear");
      } finally {
        setBusy(false);
      }
    };

    useImperativeHandle(ref, () => ({
      clearChat: clearBuildChat,
    }));

    const latestAssistantWithCards = [...messages]
      .reverse()
      .find(
        (m) =>
          m.role === "assistant" &&
          (parseCards(m).length > 0 || parseUpdateProposals(m).length > 0),
      );

    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {!loadingMessages && messages.length === 0 && !busy && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center space-y-3">
              <p className="text-sm font-medium text-gray-900">Build</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Describe scope to add products, or explicitly ask to change quantities, prices, or discounts on
                lines already on your spreadsheet. You'll review and approve each change before it's applied.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void sendMessage(prompt)}
                    className="text-xs rounded-full border border-gray-300 bg-white px-3 py-1 text-gray-700 hover:bg-gray-100 hover:border-gray-400 transition-colors text-left"
                  >
                    {prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => {
            const cards = msg.role === "assistant" ? parseCards(msg) : [];
            const updateProposals = msg.role === "assistant" ? parseUpdateProposals(msg) : [];
            const ctx =
              parseSpreadsheetContext(msg) ??
              (liveSpreadsheetContext ? normalizeSpreadsheetContext(liveSpreadsheetContext) : undefined);
            const isLatestProposalMessage = latestAssistantWithCards?.id === msg.id;

            return (
              <div key={msg.id} className="space-y-3">
                <ScopeMessageBubble
                  role={msg.role as "user" | "assistant"}
                  content={msg.content}
                />
                {updateProposals.length > 0 && (
                  <div className="space-y-2">
                    {updateProposals.map((proposal) => (
                      <BuildUpdateCard
                        key={proposal.proposalId}
                        proposal={proposal}
                        applied={
                          isLatestProposalMessage
                            ? appliedProposalIds.has(proposal.proposalId)
                            : false
                        }
                        applying={applyingProposalId === proposal.proposalId}
                        onApply={handleApplyUpdate}
                      />
                    ))}
                  </div>
                )}
                {cards.length > 0 && (
                  <div className="space-y-2">
                    {cards.map((card) => (
                      <BuildMatchCardComponent
                        key={card.itemId}
                        card={card}
                        products={products}
                        productsLoading={productsLoading}
                        spreadsheetContext={ctx}
                        added={isLatestProposalMessage ? addedItemIds.has(card.itemId) : false}
                        adding={addingItemId === card.itemId}
                        onAdd={handleAddToQuote}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {busy && (
            <p className="text-xs text-gray-500 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Working on your request…
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
            placeholder="Paste scope or ask explicitly to update qty/discount…"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-green-500"
            disabled={busy}
          />
          <div className="flex justify-end items-center gap-2">
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={busy || !input.trim()}
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

export default BuildModePanel;
