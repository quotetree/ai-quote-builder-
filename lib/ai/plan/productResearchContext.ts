import {
  isExternalWebResearchQuery,
  isPricebookPrimaryPhrase,
} from "@/lib/ai/retrieval/retrievalRouter";
import type { ChatTurn } from "@/lib/ai/plan/webResearchContext";

/** User explicitly asked about org catalog — not inferred from product keywords alone. */
export function userWantsPricebookSearch(
  userMessage: string,
  history: ChatTurn[] = [],
): boolean {
  const msg = userMessage.trim();
  if (!msg || isExternalWebResearchQuery(msg)) return false;
  if (isCatalogOnlyPricebookQuery(msg, history)) return true;
  if (isPricebookPrimaryPhrase(msg)) return true;
  if (/\b(?:our|my|the)\s+price\s*book\b/i.test(msg)) return true;
  if (/\b(?:our|my)\s+(?:catalog|parts?|products?|skus?)\b/i.test(msg)) return true;
  if (/\bwhat\s+(?:do\s+)?we\s+(?:carry|stock|sell|offer)\b/i.test(msg)) return true;
  return false;
}

const BRAND_PATTERNS: { re: RegExp; name: string }[] = [
  { re: /\bhanwha(?:\s+vision)?\b/i, name: "Hanwha Vision" },
  { re: /\bverkada\b/i, name: "Verkada" },
  { re: /\baxis\b/i, name: "Axis" },
  { re: /\bhikvision\b/i, name: "Hikvision" },
];

function extractBrand(corpus: string): string | null {
  for (const { re, name } of BRAND_PATTERNS) {
    if (re.test(corpus)) return name;
  }
  return null;
}

function normalizeTypos(msg: string): string {
  return msg
    .replace(/\bresearhc\b/gi, "research")
    .replace(/\blense\b/gi, "lens")
    .replace(/\bfishey\b/gi, "fisheye");
}

function conversationCorpus(userMessage: string, history: ChatTurn[]): string {
  return [...history.slice(-8).map((h) => h.content), normalizeTypos(userMessage)].join("\n");
}

/**
 * Price book + spec question, or follow-up about products from the thread ("these cameras you found").
 */
export function isHybridPricebookSpecQuery(
  userMessage: string,
  history: ChatTurn[] = [],
): boolean {
  const msg = normalizeTypos(userMessage.trim());
  if (!msg) return false;

  const corpus = conversationCorpus(userMessage, history);

  const asksSpec =
    /\b(mp|megapixel|megapixels|resolution|specs?|specifications?|fov|lens|lenses|sensor)\b/i.test(
      msg,
    ) || /\bwhat is the mp\b/i.test(msg);
  const hasProduct =
    /\b(fish[\s-]?eye|fisheye|cameras?|domes?|mini\s*domes?|multisensor|reader|gateway)\b/i.test(
      msg,
    ) || /\bverkada\b/i.test(msg);
  const referencesContext =
    /\b(these|those|that you found|you found|you listed|mentioned|from above|in our price\s*book|our pricebook)\b/i.test(
      msg,
    );
  const mentionsPricebook = /\b(?:our|my|the)\s+price\s*book\b/i.test(msg);

  if (asksSpec && hasProduct) return true;
  if (mentionsPricebook && asksSpec) return true;
  if (referencesContext && asksSpec) return true;

  const lastAssistant = [...history].reverse().find((h) => h.role === "assistant")?.content ?? "";
  if (asksSpec && /\b(CM\d|CD\d|CH\d|fisheye|fish[\s-]?eye|verkada)\b/i.test(lastAssistant)) {
    return true;
  }

  return false;
}

export function isCatalogOnlyPricebookQuery(
  userMessage: string,
  history: ChatTurn[] = [],
): boolean {
  const msg = userMessage.trim();
  if (isProductSpecResearchQuery(msg) || isHybridPricebookSpecQuery(msg, history)) {
    return false;
  }
  if (isPricebookPrimaryPhrase(msg)) return true;
  return (
    /\b(how much|sku|part number|do we (?:carry|stock|sell))\b/i.test(msg) &&
    !/\b(research|compare|mp|megapixel|spec|fisheye)\b/i.test(msg)
  );
}

/**
 * Open-ended product comparison / spec research (not a simple price-book SKU lookup).
 */
export function isProductSpecResearchQuery(text: string): boolean {
  const msg = normalizeTypos(text.trim());
  if (!msg) return false;

  if (/\b(?:our|my)\s+price\s*book\b/i.test(msg) && /\bhow\s+much\b/i.test(msg)) {
    return false;
  }

  if (/\b(?:do we|we)\s+(?:\w+\s+){0,4}?(?:sell|carry|stock|offer)\b/i.test(msg)) {
    return false;
  }
  if (
    /\b(?:which|what)\s+.+\s+(?:do we|we)\s+(?:\w+\s+){0,4}?(?:sell|carry|stock|offer)\b/i.test(
      msg,
    )
  ) {
    return false;
  }

  const hasResearchIntent =
    /\b(research|compare|comparison|analyze|analyse|look into|dig into|breakdown|investigate)\b/i.test(
      msg,
    );
  const hasSelectionIntent =
    /\b(which (?:one|model|camera)|what (?:model|series|camera)|tell me which)\b/i.test(msg);
  const hasSpecCriteria =
    /\b(\d+\s*mp|megapixel|resolution|lens|lenses|fov|field of view|sensor)\b/i.test(msg) ||
    /\bwhat is the mp\b/i.test(msg) ||
    /\b(mp|megapixel)\s+of\b/i.test(msg);
  const hasProductFamily =
    /\b(mini\s*domes?|domes?|cameras?|fish[\s-]?eye|fisheye|multisensor|multi\s*sensor|reader|gateway|panel)\b/i.test(
      msg,
    );

  if (!hasProductFamily) return false;

  if (hasResearchIntent) return true;
  if (hasSelectionIntent && hasSpecCriteria) return true;
  if (hasSpecCriteria && /\b(mini\s*domes?|domes?|fish[\s-]?eye|fisheye)\b/i.test(msg)) {
    return true;
  }
  if (hasSpecCriteria && /\b(these|those|you found)\b/i.test(msg)) return true;

  return false;
}

/** Product research using current message + thread context */
export function isProductResearchFromConversation(
  userMessage: string,
  history: ChatTurn[],
): boolean {
  return (
    isProductSpecResearchQuery(userMessage) ||
    isHybridPricebookSpecQuery(userMessage, history)
  );
}

export function isSimpleCatalogLookup(text: string): boolean {
  const msg = text.trim();
  if (isProductSpecResearchQuery(msg)) return false;
  if (isPricebookPrimaryPhrase(msg)) return true;
  if (/\b(?:which|what)\s+.+\s+(?:do we|we)\s+(?:\w+\s+){0,4}?(?:sell|carry|stock|offer)\b/i.test(msg)) {
    return true;
  }

  return (
    /\b(how much|sku|part number|do we (?:carry|stock|sell))\b/i.test(msg) &&
    !/\b(research|compare)\b/i.test(msg)
  );
}

function extractModelNumbers(corpus: string): string[] {
  const matches = corpus.match(/\b(?:CM|CD|CH|CP|CB|CF)\d{2}[\w-]*/gi) ?? [];
  return [...new Set(matches.map((m) => m.toUpperCase()))].slice(0, 4);
}

export function buildProductResearchWebQueries(
  userMessage: string,
  history: ChatTurn[],
): string[] {
  const msg = normalizeTypos(userMessage);
  const corpus = conversationCorpus(userMessage, history);
  const brand = extractBrand(corpus);
  const brandPrefix = brand ? `${brand} ` : "";
  const mp = corpus.match(/\b(\d+)\s*mp\b/i)?.[1];
  const models = extractModelNumbers(corpus);
  const family = /\bfish[\s-]?eye|fisheye\b/i.test(corpus)
    ? "fisheye"
    : /\bmini\s*domes?\b/i.test(corpus)
      ? "mini dome"
      : /\bdomes?\b/i.test(corpus)
        ? "dome"
        : "camera";

  const queries: string[] = [];

  if (models.length > 0) {
    for (const model of models.slice(0, 2)) {
      queries.push(`${brandPrefix}${model} megapixel resolution specifications datasheet`);
    }
  }

  queries.push(
    `${brandPrefix}${family} camera models resolution megapixel specifications datasheet`,
  );

  if (mp) {
    queries.push(`${brandPrefix}${mp}MP ${family} camera model specifications`);
  } else if (/\bwhat is the mp\b/i.test(msg) || /\bmp of\b/i.test(msg)) {
    queries.push(`${brandPrefix}${family} camera megapixel resolution specs`);
  }

  return [...new Set(queries)].slice(0, 3);
}

export function productResearchModeInstructions(
  brand: string | null,
  includePricebook: boolean,
): string {
  const brandName = brand ?? "the manufacturer";
  const pricebookStep = includePricebook
    ? `2. Use search_price_book only because the user asked about your catalog — note SKUs, **Sales (catalog)** prices exactly as returned, and any MP in the data. Never guess catalog prices from the web.\n3. Use pre-loaded Tavily results (and web_search if needed) for ${brandName} official specs (not for your catalog sales prices).\n4. Synthesize catalog + web in a clear answer.`
    : `2. Use pre-loaded Tavily results (and web_search if needed) for ${brandName} official megapixel/resolution specs, model lines, and datasheets.\n3. Synthesize a clear answer from web research — do not search the internal price book unless the user asked for it.`;
  return [
    "--- PRODUCT RESEARCH MODE ---",
    `The user wants analytical product research (not a one-line answer). Calibrate depth to task complexity — this is a **comparison/spec research** task, so be thorough.`,
    "",
    "**Required workflow:**",
    `1. Read the conversation history — if you or the user already listed product models, use THAT list (do not claim nothing was found if prior turns named SKUs/models).`,
    pricebookStep,
    "",
    "**Response format (when comparing models or MP):**",
    "- Short lead-in with the direct answer (e.g. whether any listed model is actually 8MP).",
    "- A **markdown table**: Model | Resolution | Camera type | Notes (1 line each).",
    includePricebook
      ? "- Table must include a **Sales (catalog)** column copied exactly from price book results when discussing your products/pricing."
      : "- Name specific manufacturer models and series from web research.",
    includePricebook
      ? "- If nothing in the price book matches the requested spec, say so explicitly, then explain which catalog models were checked and their real MP."
      : "",
    "- Recommend the correct product line/series for the requested spec (e.g. 8MP dome series) with brief bullets on why (coverage, detail, etc.).",
    "",
    "**Do NOT:**",
    "- Give generic advice to check the manufacturer website without naming specific models.",
    "- Use a 2-sentence answer for multi-model comparison questions.",
    includePricebook
      ? ""
      : "- Mention the internal price book or search_price_book unless the user asked about your catalog.",
  ]
    .filter(Boolean)
    .join("\n");
}
