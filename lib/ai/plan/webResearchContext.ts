import {
  isCatalogInventoryQuestion,
  isCatalogListFollowUp,
} from "@/lib/ai/plan/catalogConversation";
import {
  buildProductResearchWebQueries,
  isHybridPricebookSpecQuery,
  isProductResearchFromConversation,
  isProductSpecResearchQuery,
} from "@/lib/ai/plan/productResearchContext";
import { isPlanLayoutCameraQuery } from "@/lib/ai/plan/planLayoutAnalysis";
import {
  buildWebSearchQuery,
  isExternalWebResearchQuery,
} from "@/lib/ai/retrieval/retrievalRouter";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const BRAND_PATTERNS: { re: RegExp; name: string }[] = [
  { re: /\bhanwha(?:\s+vision)?\b/i, name: "Hanwha Vision" },
  { re: /\bverkada\b/i, name: "Verkada" },
  { re: /\baxis\b/i, name: "Axis" },
  { re: /\bhikvision\b/i, name: "Hikvision" },
  { re: /\bgenetec\b/i, name: "Genetec" },
  { re: /\bavigilon\b/i, name: "Avigilon" },
];

export function isWebSearchApprovalMessage(text: string): boolean {
  const msg = text.trim();
  if (!msg || msg.length > 120) return false;
  return /^(yes|yeah|yep|sure|ok|okay|please|go ahead|proceed|do it|continue|sounds good|that works)([.!?\s,]|$)/i.test(
    msg,
  );
}

export function assistantOfferedWebSearch(history: ChatTurn[]): boolean {
  const recentAssistant = history
    .filter((m) => m.role === "assistant")
    .slice(-3)
    .map((m) => m.content);
  return recentAssistant.some((content) =>
    /\b(web search|search online|search the web|look online|find (?:online|distributors)|distributors?|dealers?|vendors?|retailers?|hanwha.*site|proceed with)\b/i.test(
      content,
    ),
  );
}

export function userRequestedOnlineSearch(text: string): boolean {
  return (
    /\b(search online|online search|on the web|on the internet|look online|web search)\b/i.test(
      text,
    ) ||
    /\b(?:if|when).{0,50}(?:not|don't|do not|isn't|aren't).{0,30}(?:price\s*book|catalog|stock).{0,50}(?:search|look|check)\s+online\b/i.test(
      text,
    ) ||
    /\b(?:not in|isn't in|aren't in)\s+(?:our\s+)?(?:price\s*book|catalog).{0,40}(?:search|look|find)\s+online\b/i.test(
      text,
    )
  );
}

export interface ShouldRunWebResearchOptions {
  hasAttachments?: boolean;
}

export function shouldRunWebResearch(
  userMessage: string,
  history: ChatTurn[],
  options: ShouldRunWebResearchOptions = {},
): boolean {
  if (isCatalogInventoryQuestion(userMessage, history)) return false;
  if (isCatalogListFollowUp(userMessage, history)) return false;

  if (isExternalWebResearchQuery(userMessage)) return true;
  if (isProductResearchFromConversation(userMessage, history)) return true;
  if (options.hasAttachments && isPlanLayoutCameraQuery(userMessage)) {
    return true;
  }
  if (userRequestedOnlineSearch(userMessage)) return true;
  if (isWebSearchApprovalMessage(userMessage) && assistantOfferedWebSearch(history)) {
    return true;
  }
  return false;
}

export function isProductResearchMode(userMessage: string, history: ChatTurn[]): boolean {
  return isProductResearchFromConversation(userMessage, history);
}

export function isWebResearchFollowUp(userMessage: string, history: ChatTurn[]): boolean {
  if (/\b(?:our|my)\s+price\s*book\b/i.test(userMessage)) return false;
  if (/\bcompare\b/i.test(userMessage) && /\bprice\s*book|catalog\b/i.test(userMessage)) {
    return false;
  }
  return (
    isWebSearchApprovalMessage(userMessage) &&
    assistantOfferedWebSearch(history) &&
    !isExternalWebResearchQuery(userMessage)
  );
}

export function extractBrandFromConversation(
  userMessage: string,
  history: ChatTurn[],
): string | null {
  const corpus = [...history.slice(-8).map((m) => m.content), userMessage].join("\n");
  return extractBrand(corpus);
}

function extractBrand(corpus: string): string | null {
  for (const { re, name } of BRAND_PATTERNS) {
    if (re.test(corpus)) return name;
  }
  return null;
}

function extractCameraHints(corpus: string): string {
  const hints: string[] = [];
  const mp = corpus.match(/\b(\d+)\s*mp\b/i);
  if (mp) hints.push(`${mp[1]}MP`);
  if (/\bmultisensor|multi\s*sensor\b/i.test(corpus)) hints.push("multisensor");
  if (/\bpanoramic|180\b/i.test(corpus)) hints.push("panoramic outdoor dome");
  if (/\bvandal\b/i.test(corpus)) hints.push("vandal dome");
  if (/\boutdoor\b/i.test(corpus)) hints.push("outdoor");
  if (/\bindoor\b/i.test(corpus)) hints.push("indoor");
  if (/\bdome\b/i.test(corpus)) hints.push("dome camera");
  return hints.slice(0, 4).join(" ");
}

/**
 * Build 1–2 focused Tavily queries from the current message + recent chat.
 */
export function buildWebSearchQueriesFromConversation(
  userMessage: string,
  history: ChatTurn[],
): string[] {
  const recent = history.slice(-8);
  const corpus = [...recent.map((m) => m.content), userMessage].join("\n");
  const brand = extractBrand(corpus);
  const cameraHints = extractCameraHints(corpus);
  const queries: string[] = [];

  const wantsDistributors =
    isExternalWebResearchQuery(userMessage) ||
    /\b(distribut|dealer|vendor|where to buy|integrator|proceed|retailer)\b/i.test(corpus);

  const wantsProducts =
    /\b(camera|cameras|model|sku|part number|buy|stock|price)\b/i.test(corpus) &&
    !/^\s*(yes|ok|proceed)/i.test(userMessage.trim());

  if (wantsDistributors) {
    const base = brand ?? "security low voltage";
    queries.push(
      `${base} authorized distributors United States ADI Wesco ScanSource TD SYNNEX integrator`,
    );
  }

  if (isProductResearchFromConversation(userMessage, history)) {
    queries.push(...buildProductResearchWebQueries(userMessage, history));
  } else if (wantsProducts || (brand && cameraHints)) {
    const productQuery = [brand, cameraHints, "camera buy online model"]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (productQuery.length > 8) queries.push(productQuery);
  }

  if (queries.length === 0) {
    queries.push(buildWebSearchQuery(userMessage.trim() || corpus.slice(-400)));
  }

  return [...new Set(queries)].slice(0, 2);
}

export function webResearchModeInstructions(brand: string | null): string {
  const brandLine = brand
    ? `Focus on **${brand}** unless the conversation names another manufacturer.`
    : "";
  return [
    "--- WEB RESEARCH MODE ---",
    "Answer using pre-loaded Tavily results below. Give concrete, actionable answers — not generic advice to 'contact local distributors' or 'check online retailers'.",
    brandLine,
    "For distributors: list named companies (e.g. ADI Global Distribution, Wesco/Anixter, ScanSource, TD SYNNEX, Alarmax when relevant) with markdown links and one-line notes on what they carry.",
    "For products not in the price book: list specific camera models that match the discussed specs (MP, dome, outdoor/indoor) with markdown links.",
    "If Tavily results are thin, call web_search once with a refined query — do NOT call read_page unless snippets are clearly insufficient.",
    "Do NOT say you could not access a manufacturer website — use distributor and retailer results from search.",
  ]
    .filter(Boolean)
    .join("\n");
}
