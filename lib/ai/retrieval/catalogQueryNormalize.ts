import {
  expandCatalogSearchTerms,
  isGenericProductTerm,
  normalizeTechnicalText,
  tokenMatchesProductText,
} from "@/lib/ai/retrieval/catalogQueryExpand";

const STRIP_PHRASES = [
  /\bfind(?:\s+me)?\s+all(?:\s+of)?(?:\s+the)?\s+(?:different\s+)?/gi,
  /\b(?:let me know|tell me)\s+(?:what|the)\b/gi,
  /\b(?:pricing|margins?)\s+(?:for|on)\s+each\b/gi,
  /\bhow\s+much\s+(?:is|are|does|do)\b/gi,
  /\bwhat\s+(?:is|are)\s+the\s+price\b/gi,
  /\bin\s+our\s+price\s*book\b/gi,
  /\bour\s+price\s*book\b/gi,
  /\bthe\s+price\s*book\b/gi,
  /\bprice\s*book\b/gi,
  /\bdo\s+we\s+sell\b/gi,
  /\bwhat\s+do\s+we\s+(?:carry|stock|sell)\b/gi,
  /\bcan\s+you\s+find\b/gi,
  /\bplease\s+find\b/gi,
  /\bthat\s+we\s+sell\b/gi,
  /\bwe\s+sell\b/gi,
];

const STOP_WORDS = new Set([
  "how",
  "much",
  "what",
  "is",
  "are",
  "the",
  "our",
  "in",
  "a",
  "an",
  "for",
  "of",
  "to",
  "and",
  "or",
  "do",
  "does",
  "did",
  "can",
  "you",
  "me",
  "my",
  "we",
  "sell",
  "sold",
  "price",
  "pricing",
  "cost",
  "please",
  "find",
  "show",
  "list",
  "get",
  "tell",
  "about",
  "any",
  "some",
  "all",
  "every",
  "each",
  "that",
  "which",
  "currently",
  "models",
  "model",
  "under",
  "below",
  "less",
  "than",
  "over",
  "above",
  "more",
  "at",
  "no",
  "max",
  "maximum",
  "min",
  "minimum",
  "up",
  "usd",
  "dollar",
  "dollars",
  "bucks",
  "different",
  "various",
  "margin",
  "margins",
  "markup",
  "profit",
]);

/** Known brands — longest match first */
const BRAND_ALIASES: [RegExp, string][] = [
  [/\bverkada\b/i, "verkada"],
  [/\baxis\b/i, "axis"],
  [/\bhanwha\b/i, "hanwha"],
  [/\bavigilon\b/i, "avigilon"],
  [/\bopenpath\b/i, "openpath"],
  [/\bbrivo\b/i, "brivo"],
  [/\bhid\b/i, "hid"],
];

export interface NormalizedCatalogQuery {
  /** Cleaned text for embedding / fuzzy search */
  searchText: string;
  /** Tokens used for keyword scoring (no stop words) */
  terms: string[];
  /** Optional manufacturer filter from query */
  manufacturer?: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 0);
}

/**
 * Normalize a natural-language catalog question into searchable terms.
 */
export function normalizeCatalogQuery(raw: string): NormalizedCatalogQuery {
  let text = normalizeTechnicalText(raw.trim());
  for (const p of STRIP_PHRASES) {
    text = text.replace(p, " ");
  }
  text = text.replace(/\s+/g, " ").trim();

  let manufacturer: string | undefined;
  for (const [pattern, brand] of BRAND_ALIASES) {
    if (pattern.test(text)) {
      manufacturer = brand;
      text = text.replace(pattern, " ").replace(/\s+/g, " ").trim();
      break;
    }
  }

  // Expand common aliases in remaining text
  text = text.replace(/\bmulti\s*sensor\b/gi, "multisensor multi sensor");

  const allTokenized = tokenize(text).filter(
    (t) => !STOP_WORDS.has(t) && (t.length > 1 || /^\d+$/.test(t)),
  );
  const expanded = expandCatalogSearchTerms(raw, allTokenized);
  const coreTerms =
    expanded.coreTerms.length > 0
      ? expanded.coreTerms
      : allTokenized.filter((t) => !isGenericProductTerm(t));

  let uniqueTerms = [...new Set(coreTerms.length > 0 ? coreTerms : allTokenized)];
  // Drop bare price amounts so "camera under 1000" does not require "1000" in product text
  uniqueTerms = uniqueTerms.filter((t) => !/^\d{2,}(?:\.\d+)?$/.test(t));

  if (manufacturer && !uniqueTerms.includes(manufacturer)) {
    uniqueTerms.unshift(manufacturer);
  }

  return {
    searchText: uniqueTerms.join(" ") || raw.trim(),
    terms: uniqueTerms,
    manufacturer,
  };
}

/**
 * Score how well product text matches catalog query terms (not strict AND).
 */
export function scoreCatalogMatch(
  productText: string,
  terms: string[],
  options?: { manufacturer?: string; brandField?: string },
): number {
  if (terms.length === 0) return 0;

  const hay = normalizeTechnicalText(productText.toLowerCase());
  const brand = (options?.brandField ?? "").toLowerCase();
  const coreTerms = terms.filter((t) => !isGenericProductTerm(t));
  const matchTerms = coreTerms.length > 0 ? coreTerms : terms;

  if (options?.manufacturer) {
    const mfr = options.manufacturer.toLowerCase();
    if (!brand.includes(mfr) && !hay.includes(mfr)) return 0;
  }

  let hits = 0;
  for (const term of matchTerms) {
    if (tokenMatchesProductText(term, hay)) {
      hits += 1;
      continue;
    }
    if (term === "multisensor" && /\bmulti\s*sensor\b/.test(hay)) hits += 1;
    else if (term === "sensor" && /\b(multisensor|multi\s*sensor)\b/.test(hay)) hits += 1;
  }

  if (hits === 0) return 0;

  const ratio = hits / matchTerms.length;
  if (options?.manufacturer && hits >= 1) {
    return Math.max(ratio, 0.55);
  }
  return ratio;
}

export function passesCatalogMatchThreshold(
  score: number,
  termCount: number,
  options?: { categoryBrowse?: boolean },
): boolean {
  if (score <= 0) return false;
  if (options?.categoryBrowse && termCount <= 2) return score >= 0.35;
  if (termCount <= 2) return score >= 0.5;
  if (termCount <= 4) return score >= 0.4;
  return score >= 0.35;
}
