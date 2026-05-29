import { NextRequest } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { buildPricebookCopilotContext } from "@/lib/ai/buildPricebookCopilotContext";
import { catalogPricingGroundingInstructions } from "@/lib/ai/plan/catalogPricingGrounding";
import { runMandatoryCatalogSearch } from "@/lib/ai/plan/mandatoryCatalogSearch";
import type { ChatTurn } from "@/lib/ai/plan/webResearchContext";
import {
  PRICEBOOK_COPILOT_SYSTEM_PROMPT,
  SEARCH_PRICE_BOOK_TOOL,
  type PlanInternalSourceCitation,
} from "@/lib/ai/planPrompts";
import {
  enrichCatalogFiltersFromTerms,
  parseCatalogQueryFilters,
} from "@/lib/ai/retrieval/catalogQueryFilters";
import { normalizeCatalogQuery } from "@/lib/ai/retrieval/catalogQueryNormalize";
import {
  assessPricebookTaskComplexity,
  dedupeHistoryCurrentMessage,
  filterCatalogHistory,
  pricebookTurnInstructions,
  trimChatHistory,
} from "@/lib/ai/pricebookCopilot/turnHelpers";
import {
  referentialFollowUpInstructions,
  resolveReferentialFollowUp,
} from "@/lib/ai/pricebookCopilot/referentialFollowUp";
import {
  fetchPriceBookProductsByIds,
  formatPinnedResultSetForPrompt,
  formatPriceBookResultsForPrompt,
  searchPriceBook,
  type PriceBookSearchParams,
} from "@/lib/ai/searchPriceBook";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TOOL_ITERATIONS = 4;
const MAX_PRICE_BOOK_SEARCH_ROUNDS = 4;

interface PlanRequestBody {
  projectId: string;
  activeSpreadsheetId?: string | null;
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

function ndjsonLine(obj: Record<string, unknown>): string {
  return `${JSON.stringify(obj)}\n`;
}

function parsePriceBookArgs(raw: string): PriceBookSearchParams {
  try {
    const args = JSON.parse(raw) as PriceBookSearchParams & { query?: string };
    return {
      query: args.query?.trim() ?? "",
      category: args.category?.trim() || undefined,
      manufacturer: args.manufacturer?.trim() || undefined,
      tags: Array.isArray(args.tags)
        ? args.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        : undefined,
      use_case: args.use_case?.trim() || undefined,
      max_results:
        typeof args.max_results === "number" && Number.isFinite(args.max_results)
          ? args.max_results
          : undefined,
      max_sales_price:
        typeof args.max_sales_price === "number" && Number.isFinite(args.max_sales_price)
          ? args.max_sales_price
          : undefined,
      min_sales_price:
        typeof args.min_sales_price === "number" && Number.isFinite(args.min_sales_price)
          ? args.min_sales_price
          : undefined,
    };
  } catch {
    return { query: "" };
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(ndjsonLine({ type: "error", error: "OpenAI API key not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(ndjsonLine({ type: "error", error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  let body: PlanRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(ndjsonLine({ type: "error", error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  const { projectId, message, history } = body;

  if (!projectId || !message?.trim()) {
    return new Response(ndjsonLine({ type: "error", error: "projectId and message are required" }), {
      status: 400,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  const userMessageText = message.trim();

  const historyMessages = trimChatHistory(
    filterCatalogHistory(
      dedupeHistoryCurrentMessage(
        (history ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        userMessageText,
      ),
    ),
  );

  const turnNumber = historyMessages.length + 1;
  const taskComplexity = assessPricebookTaskComplexity(userMessageText);
  const referentialFollowUp = resolveReferentialFollowUp(
    userMessageText,
    historyMessages as ChatTurn[],
  );

  const fullContext = await buildPricebookCopilotContext(supabase, projectId, {
    userMessage: userMessageText,
    skipRetrieval: Boolean(referentialFollowUp),
  });

  if (!fullContext) {
    return new Response(ndjsonLine({ type: "error", error: "Project not found" }), {
      status: 404,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  const { data: projectOrg } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();
  const organizationId = projectOrg?.organization_id as string | undefined;

  let contextBlock = fullContext.combinedPrompt;
  contextBlock = `${contextBlock}\n\n${pricebookTurnInstructions(taskComplexity, turnNumber)}`;
  contextBlock = `${contextBlock}\n\n${catalogPricingGroundingInstructions()}`;
  if (referentialFollowUp) {
    contextBlock = `${contextBlock}\n\n${referentialFollowUpInstructions(referentialFollowUp)}`;
  }
  contextBlock = `${contextBlock}\n\n--- CATALOG MODE ---\nAnswer **only** from prefetched Price book results and search_price_book. Include **every** matching row for filter/list questions. Do not invent products or use external knowledge.`;

  const internalSources: PlanInternalSourceCitation[] = fullContext.internalSources.map((s) => ({
    type: s.type,
    label: s.label,
    id: s.id,
    fileName: s.fileName,
    pageStart: s.pageStart,
    pageEnd: s.pageEnd,
  }));

  let preloadedMandatoryCatalogBlock = "";
  let pinnedProductIds: string[] | null = null;
  if (organizationId) {
    try {
      if (referentialFollowUp) {
        pinnedProductIds = referentialFollowUp.productIds;
        const pinned = await fetchPriceBookProductsByIds(
          supabase,
          organizationId,
          pinnedProductIds,
        );
        preloadedMandatoryCatalogBlock = formatPinnedResultSetForPrompt(pinned, {
          priorLabel: referentialFollowUp.priorResultLabel,
          userQuestion: userMessageText,
        });
      } else {
        preloadedMandatoryCatalogBlock = await runMandatoryCatalogSearch(
          supabase,
          organizationId,
          userMessageText,
          historyMessages as ChatTurn[],
        );
      }
    } catch (err) {
      console.error("[plan] mandatory catalog search failed", err);
      preloadedMandatoryCatalogBlock =
        "--- PRICE BOOK SEARCH ---\nCatalog search failed. Call search_price_book before listing any products. Do not invent SKUs or prices.";
    }
  }

  const userTurnParts = [userMessageText];
  if (preloadedMandatoryCatalogBlock) {
    if (referentialFollowUp) {
      userTurnParts.unshift(
        "REFERENTIAL FOLLOW-UP: The user means the products from your PREVIOUS answer only. Use the PINNED PRICE BOOK RESULT SET below — do NOT search the full catalog.",
      );
    } else {
      userTurnParts.unshift(
        "Use ONLY the PRICE BOOK SEARCH block below — ignore any prior assistant catalog lists without `[pricebook:uuid]` tags.",
      );
    }
    userTurnParts.push(preloadedMandatoryCatalogBlock);
  }
  const userTurnContent = userTurnParts.join("\n\n");

  const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: PRICEBOOK_COPILOT_SYSTEM_PROMPT },
    { role: "user", content: `--- PRICE BOOK CONTEXT ---\n${contextBlock}` },
    ...historyMessages,
    { role: "user", content: userTurnContent },
  ];

  const planTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [SEARCH_PRICE_BOOK_TOOL];

  const streamMaxTokens =
    taskComplexity === "simple" ? 900 : taskComplexity === "deep" ? 4500 : 2800;

  let priceBookSearchRounds = 0;

  try {
    let iterations = 0;
    while (iterations < MAX_TOOL_ITERATIONS) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.15,
        messages: chatMessages,
        tools: planTools,
        tool_choice: "auto",
      });

      const choice = completion.choices[0]?.message;
      if (!choice) break;

      const toolCalls = choice.tool_calls;
      if (!toolCalls?.length) {
        break;
      }

      chatMessages.push(choice);

      for (const call of toolCalls) {
        if (call.type !== "function" || call.function.name !== "search_price_book") continue;

        if (pinnedProductIds?.length && organizationId) {
          const pinned = await fetchPriceBookProductsByIds(
            supabase,
            organizationId,
            pinnedProductIds,
          );
          chatMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: formatPinnedResultSetForPrompt(pinned, {
              priorLabel: referentialFollowUp?.priorResultLabel,
              userQuestion: userMessageText,
            }),
          });
          continue;
        }

        if (priceBookSearchRounds >= MAX_PRICE_BOOK_SEARCH_ROUNDS) {
          chatMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content:
              "Price book search limit reached for this message (max 4 searches). Summarize from prior results.",
          });
          continue;
        }
        priceBookSearchRounds += 1;

        const params = parsePriceBookArgs(call.function.arguments);
        if (!params.query) {
          chatMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: "Price book search requires a non-empty query string.",
          });
          continue;
        }

        if (!organizationId) {
          chatMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: "Organization not found for this project.",
          });
          continue;
        }

        try {
          const userNorm = normalizeCatalogQuery(userMessageText);
          const userFilters = enrichCatalogFiltersFromTerms(
            parseCatalogQueryFilters(userMessageText),
            userNorm.terms,
          );
          const normalized = normalizeCatalogQuery(params.query);
          const search = await searchPriceBook(
            supabase,
            {
              ...params,
              query: normalized.searchText || params.query,
              manufacturer: params.manufacturer || normalized.manufacturer,
              category: params.category || userFilters.categoryHint,
              max_sales_price: params.max_sales_price ?? userFilters.maxSalesPrice,
              min_sales_price: params.min_sales_price ?? userFilters.minSalesPrice,
            },
            { organizationId },
          );
          chatMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: formatPriceBookResultsForPrompt(search),
          });
        } catch (err) {
          chatMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `Price book search failed: ${err instanceof Error ? err.message : "unknown"}`,
          });
        }
      }

      iterations += 1;
    }

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.15,
      max_tokens: streamMaxTokens,
      stream: true,
      messages: chatMessages,
    });

    console.log(
      `[plan] pricebook copilot | turn=${turnNumber} depth=${taskComplexity} referential=${Boolean(referentialFollowUp)} pinned=${pinnedProductIds?.length ?? 0} searches=${priceBookSearchRounds} maxTok=${streamMaxTokens}`,
    );

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          let full = "";
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? "";
            if (text) {
              full += text;
              controller.enqueue(encoder.encode(ndjsonLine({ type: "chunk", text })));
            }
          }
          controller.enqueue(
            encoder.encode(
              ndjsonLine({
                type: "done",
                internalSources: internalSources.length > 0 ? internalSources : undefined,
                routedSources: ["pricebook"],
                fullLength: full.length,
              }),
            ),
          );
        } catch (err) {
          console.error("[plan] stream error", err);
          controller.enqueue(
            encoder.encode(
              ndjsonLine({
                type: "error",
                error: err instanceof Error ? err.message : "Stream failed",
              }),
            ),
          );
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[plan] error", err);
    const msg = err instanceof Error ? err.message : "Price Book Copilot failed";
    return new Response(ndjsonLine({ type: "error", error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }
}
