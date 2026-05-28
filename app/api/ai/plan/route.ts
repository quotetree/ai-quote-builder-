import { NextRequest } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { buildFullProjectContext } from "@/lib/ai/buildFullProjectContext";
import {
  checkAttachmentsReady,
  ensureAttachmentsAnalyzed,
} from "@/lib/ai/planAttachmentContext";
import { extractUrlsFromText } from "@/lib/ai/extractUrlsFromMessage";
import { type ScrapeCache, scrapePageCached } from "@/lib/ai/firecrawlScrape";
import {
  PLAN_SYSTEM_PROMPT,
  RFP_ESTIMATOR_SYSTEM_PROMPT,
  READ_PAGE_TOOL,
  SEARCH_PRICE_BOOK_TOOL,
  WEB_SEARCH_TOOL,
  type PlanDocumentCitation,
  type PlanSource,
} from "@/lib/ai/planPrompts";
import {
  formatPriceBookResultsForPrompt,
  searchPriceBook,
  type PriceBookSearchParams,
} from "@/lib/ai/searchPriceBook";
import { formatSearchResultsForPrompt, searchWeb } from "@/lib/ai/tavilySearch";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_TOOL_ITERATIONS = 8;
const MAX_WEB_SEARCH_ROUNDS = 2;
const MAX_PRICE_BOOK_SEARCH_ROUNDS = 4;
const MAX_READ_PAGE_ROUNDS = 3;
const MAX_USER_URL_PRELOAD = 2;

interface PlanRequestBody {
  projectId: string;
  activeSpreadsheetId?: string | null;
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
  attachmentIds?: string[];
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

  const { projectId, activeSpreadsheetId, message, history, attachmentIds } = body;

  if (!projectId || !message?.trim()) {
    return new Response(ndjsonLine({ type: "error", error: "projectId and message are required" }), {
      status: 400,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  if (attachmentIds && attachmentIds.length > 0) {
    const readiness = await checkAttachmentsReady(supabase, projectId, attachmentIds);
    if (!readiness.ready) {
      return new Response(
        ndjsonLine({
          type: "error",
          error: readiness.error ?? "Attachments are not ready",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/x-ndjson" },
        },
      );
    }
    await ensureAttachmentsAnalyzed(supabase, projectId, attachmentIds);
  }

  const fullContext = await buildFullProjectContext(supabase, projectId, {
    activeSpreadsheetId: activeSpreadsheetId ?? null,
    userMessage: message.trim(),
    attachmentIds,
  });

  if (!fullContext) {
    return new Response(ndjsonLine({ type: "error", error: "Project not found" }), {
      status: 404,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  const contextBlock = fullContext.combinedPrompt;
  const documentCitations: PlanDocumentCitation[] = fullContext.documentCitations.map(
    (c) => ({
      fileName: c.fileName,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
    }),
  );

  const historyMessages = (history ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-16)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const systemPrompt = fullContext.isRfpAnalysisMode
    ? `${PLAN_SYSTEM_PROMPT}\n\n${RFP_ESTIMATOR_SYSTEM_PROMPT}`
    : PLAN_SYSTEM_PROMPT;

  const sources: PlanSource[] = [];
  const scrapeCache: ScrapeCache = new Map();
  const userMessageText = message.trim();
  const userProvidedUrls = extractUrlsFromText(userMessageText);

  let preloadedPageBlock = "";
  let userPagesPreloaded = false;
  if (userProvidedUrls.length > 0 && process.env.FIRECRAWL_API_KEY) {
    const blocks: string[] = [];
    for (const url of userProvidedUrls.slice(0, MAX_USER_URL_PRELOAD)) {
      const { formatted, result } = await scrapePageCached(url, scrapeCache);
      blocks.push(formatted);
      if (result.success) {
        userPagesPreloaded = true;
        if (!sources.some((s) => s.url === result.url)) {
          sources.push({ title: result.title, url: result.url });
        }
      }
    }
    if (blocks.length > 0) {
      preloadedPageBlock = [
        "--- USER-PROVIDED WEB PAGE(S) (Firecrawl) ---",
        blocks.join("\n\n---\n\n"),
        "",
        userPagesPreloaded
          ? "Answer using the extracted page content above. Do not call web_search unless this content is clearly insufficient. You may call read_page only for a different URL if needed."
          : "Page extraction failed for the URL(s) above. You may use web_search to find alternative sources.",
      ].join("\n");
    }
  } else if (userProvidedUrls.length > 0 && !process.env.FIRECRAWL_API_KEY) {
    preloadedPageBlock = [
      "--- USER-PROVIDED URL(S) ---",
      userProvidedUrls.join("\n"),
      "",
      "Firecrawl is not configured, so full page content could not be extracted. Use web_search only if you cannot answer from project context.",
    ].join("\n");
  }

  const userTurnContent = preloadedPageBlock
    ? `${userMessageText}\n\n${preloadedPageBlock}`
    : userMessageText;

  const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `--- PROJECT CONTEXT ---\n${contextBlock}` },
    ...historyMessages,
    { role: "user", content: userTurnContent },
  ];

  const planTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [SEARCH_PRICE_BOOK_TOOL];
  if (process.env.TAVILY_API_KEY) {
    planTools.push(WEB_SEARCH_TOOL);
  }
  if (process.env.FIRECRAWL_API_KEY) {
    planTools.push(READ_PAGE_TOOL);
  }

  let webSearchRounds = 0;
  let priceBookSearchRounds = 0;
  let readPageRounds = 0;

  try {
    let iterations = 0;
    while (iterations < MAX_TOOL_ITERATIONS) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.6,
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
        if (call.type !== "function") continue;

        if (call.function.name === "search_price_book") {
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

          try {
            const search = await searchPriceBook(supabase, params);
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
          continue;
        }

        if (call.function.name === "web_search") {
          if (!process.env.TAVILY_API_KEY) {
            chatMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: "Web search is not configured.",
            });
            continue;
          }

          if (userPagesPreloaded) {
            chatMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content:
                "Skip web_search: the user provided URL(s) and full page content is already pre-loaded. Answer from that content unless it is clearly insufficient.",
            });
            continue;
          }

          if (webSearchRounds >= MAX_WEB_SEARCH_ROUNDS) {
            chatMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: "Search limit reached for this message (max 2 web searches).",
            });
            continue;
          }
          webSearchRounds += 1;

          let query = userMessageText;
          try {
            const args = JSON.parse(call.function.arguments) as { query?: string };
            if (args.query?.trim()) query = args.query.trim();
          } catch {
            /* use message */
          }

          try {
            const search = await searchWeb(query);
            for (const r of search.results) {
              if (r.url && !sources.some((s) => s.url === r.url)) {
                sources.push({ title: r.title, url: r.url });
              }
            }
            chatMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: formatSearchResultsForPrompt(search),
            });
          } catch (err) {
            chatMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: `Search failed: ${err instanceof Error ? err.message : "unknown"}`,
            });
          }
          continue;
        }

        if (call.function.name === "read_page") {
          if (!process.env.FIRECRAWL_API_KEY) {
            chatMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: "Page reading is not configured (FIRECRAWL_API_KEY missing).",
            });
            continue;
          }

          if (readPageRounds >= MAX_READ_PAGE_ROUNDS) {
            chatMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: `Page read limit reached (max ${MAX_READ_PAGE_ROUNDS} per message). Summarize from prior extracts and Tavily snippets.`,
            });
            continue;
          }

          let pageUrl = "";
          try {
            const args = JSON.parse(call.function.arguments) as { url?: string };
            pageUrl = args.url?.trim() ?? "";
          } catch {
            /* empty */
          }

          if (!pageUrl) {
            chatMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: "read_page requires a non-empty url parameter.",
            });
            continue;
          }

          readPageRounds += 1;

          try {
            const { formatted, result } = await scrapePageCached(pageUrl, scrapeCache);
            if (result.success && result.url) {
              if (!sources.some((s) => s.url === result.url)) {
                sources.push({ title: result.title, url: result.url });
              }
            }
            chatMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: formatted,
            });
          } catch (err) {
            chatMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: `Page read failed: ${err instanceof Error ? err.message : "unknown"}. Use Tavily snippets if available.`,
            });
          }
        }
      }

      iterations += 1;
    }

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.6,
      stream: true,
      messages: chatMessages,
    });

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
                sources,
                documentCitations:
                  documentCitations.length > 0 ? documentCitations : undefined,
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
    const msg = err instanceof Error ? err.message : "Plan chat failed";
    return new Response(ndjsonLine({ type: "error", error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }
}
