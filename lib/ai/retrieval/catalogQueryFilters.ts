/** Parsed filters from natural-language price book questions. */

import {
  isGenericProductTerm,
  tokenMatchesProductText,
} from "@/lib/ai/retrieval/catalogQueryExpand";

export interface CatalogQueryFilters {
  maxSalesPrice?: number;
  minSalesPrice?: number;
  /** Product/service phrase to match across name, type, family, tags, description */
  categoryHint?: string;
  /** Brand/manufacturer filter from query (verkada, axis, …) */
  manufacturer?: string;
  /** User asked to list all / every matching item — return full result set */
  listAll?: boolean;
}

const BRAND_FROM_QUERY: [RegExp, string][] = [
  [/\bverkada\b/i, "verkada"],
  [/\baxis\b/i, "axis"],
  [/\bhanwha(?:\s+vision)?\b/i, "hanwha"],
  [/\bavigilon\b/i, "avigilon"],
  [/\bopenpath\b/i, "openpath"],
  [/\bbrivo\b/i, "brivo"],
  [/\bhid\b/i, "hid"],
  [/\brhombus\b/i, "rhombus"],
];

const FROM_BRAND_RE =
  /\bfrom\s+(verkada|axis|hanwha|avigilon|openpath|brivo|hid|rhombus)\b/i;

const WHICH_WE_SELL_RE =
  /\b(?:which|what)\s+(.+?)\s+(?:do we|we)\s+(?:\w+\s+){0,4}?(?:sell|carry|stock|offer)\b/i;

/** Hard safety cap for a single Copilot turn (compact table format). */
export const CATALOG_LIST_ALL_CAP = 1000;

/** k-suffix first so "1k" is not captured as "1" */
const MONEY_AMOUNT = String.raw`(?:\$|usd\s*)?([\d,]+(?:\.\d+)?\s*k\b|[\d,]+(?:\.\d{1,2})?)(?!\s*k\b)`;

const MAX_PRICE_PATTERNS = [
  new RegExp(
    `\\b(?:under|below|less\\s+than|at\\s+or\\s+under|no\\s+more\\s+than|max(?:imum)?|up\\s+to)\\s*${MONEY_AMOUNT}`,
    "i",
  ),
];

const MIN_PRICE_PATTERNS = [
  new RegExp(
    `\\b(?:over|above|more\\s+than|at\\s+least|min(?:imum)?)\\s*${MONEY_AMOUNT}`,
    "i",
  ),
];

const LIST_IN_CATALOG_RE =
  /\b(?:all|every|each|list|find(?:\s+me)?|show(?:\s+me)?)\s+(?:the\s+)?(.+?)\s+(?:in|from|on)\s+(?:our\s+)?(?:price\s*book|pricebook|catalog)\b/i;

const FIND_WE_SELL_RE =
  /\b(?:find|show|list)(?:\s+me)?\s+(?:all(?:\s+of)?(?:\s+the)?\s+)?(?:different\s+)?(.+?)\s+(?:that\s+)?(?:we\s+)?(?:sell|carry|stock|offer)\b/i;

const WHAT_WE_CARRY_RE =
  /\bwhat\s+(.+?)\s+do we\s+(?:carry|stock|sell|offer)\b/i;

const SOLD_AT_PRICE_RE =
  /\b(?:sold|priced|listed)\s+(?:at|for)\s+(?:under|below|less\s+than|over|above)\b/i;

const CATEGORY_NOISE =
  /\b(?:all|the|models?|items?|products?|parts?|skus?|lines?|options?|that|which|are|is|currently|we|sell|carrying|stock|in|our|have|got)\b/gi;

/** Stripped from category hints built from search terms — not product types */
const CATEGORY_TERM_STOP = new Set([
  "carry",
  "carrying",
  "stock",
  "sell",
  "selling",
  "offer",
  "offering",
  "have",
  "got",
  "find",
  "show",
  "list",
  "please",
  "what",
  "which",
  "how",
  "much",
  "different",
  "various",
]);

const CAMERA_PRODUCT_RE =
  /\b(camera|cameras|cctv|dome|bullet|ptz|multisensor|multi[\s-]?sensor|fisheye|fish[\s-]?eye|nvr|dvr|encoder)\b/i;

function parseMoney(raw: string): number | undefined {
  const s = raw.trim().toLowerCase().replace(/,/g, "");
  const kMatch = /^([\d.]+)\s*k$/.exec(s);
  if (kMatch?.[1]) {
    const n = Number(kMatch[1]) * 1000;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanCategoryPhrase(phrase: string): string {
  return phrase
    .replace(CATEGORY_NOISE, " ")
    .replace(SOLD_AT_PRICE_RE, " ")
    .replace(/\b(?:that|which)\s+(?:are|is)\b/gi, " ")
    .replace(/\bunder\s+\$?[\d,k.]+\b/gi, " ")
    .replace(/\bover\s+\$?[\d,k.]+\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractProductPhraseFromQuery(raw: string): string | undefined {
  const findSellMatch = raw.match(FIND_WE_SELL_RE);
  if (findSellMatch?.[1]) {
    const cleaned = cleanCategoryPhrase(findSellMatch[1]);
    if (cleaned.length > 0) return cleaned;
  }

  const listMatch = raw.match(LIST_IN_CATALOG_RE);
  if (listMatch?.[1]) {
    const cleaned = cleanCategoryPhrase(listMatch[1]);
    if (cleaned.length > 0) return cleaned;
  }

  const carryMatch = raw.match(WHAT_WE_CARRY_RE);
  if (carryMatch?.[1]) {
    const cleaned = cleanCategoryPhrase(carryMatch[1]);
    if (cleaned.length > 0) return cleaned;
  }

  return undefined;
}

export function meaningfulCategoryTokens(hintOrTerms: string | string[]): string[] {
  const parts = Array.isArray(hintOrTerms)
    ? hintOrTerms
    : hintOrTerms.split(/\s+/);
  return parts
    .map((t) => t.trim().toLowerCase())
    .filter(
      (t) =>
        t.length > 1 &&
        !CATEGORY_TERM_STOP.has(t) &&
        !isGenericProductTerm(t),
    );
}

/** Build category hint from search terms (drops carry/stock/etc.). */
const BRAND_NAMES = new Set(BRAND_FROM_QUERY.map(([, b]) => b));

export function parseManufacturerFromQuery(raw: string): string | undefined {
  const fromMatch = raw.match(FROM_BRAND_RE);
  if (fromMatch?.[1]) return fromMatch[1].toLowerCase();

  for (const [pattern, brand] of BRAND_FROM_QUERY) {
    if (pattern.test(raw)) return brand;
  }
  return undefined;
}

export function buildCategoryHintFromTerms(terms: string[]): string | undefined {
  const meaningful = meaningfulCategoryTokens(terms).filter((t) => !BRAND_NAMES.has(t));
  if (meaningful.length === 0) return undefined;
  return meaningful.join(" ");
}

export function inferCategoryHintFromTerms(terms: string[]): string | undefined {
  return buildCategoryHintFromTerms(terms);
}

function tokenMatchesInBlob(token: string, blob: string): boolean {
  const t = token.toLowerCase();
  if (new RegExp(`\\b${escapeRegex(t)}\\b`, "i").test(blob)) return true;
  if (t.endsWith("s") && t.length > 2) {
    const singular = t.slice(0, -1);
    if (new RegExp(`\\b${escapeRegex(singular)}\\b`, "i").test(blob)) return true;
  }
  if (!t.endsWith("s") && new RegExp(`\\b${escapeRegex(t)}s\\b`, "i").test(blob)) return true;
  return false;
}

export function parseCatalogQueryFilters(raw: string): CatalogQueryFilters {
  const filters: CatalogQueryFilters = {};
  let text = raw;

  for (const p of MAX_PRICE_PATTERNS) {
    const m = text.match(p);
    if (m?.[1]) {
      filters.maxSalesPrice = parseMoney(m[1]);
      text = text.replace(m[0], " ");
      break;
    }
  }

  for (const p of MIN_PRICE_PATTERNS) {
    const m = text.match(p);
    if (m?.[1]) {
      filters.minSalesPrice = parseMoney(m[1]);
      text = text.replace(m[0], " ");
      break;
    }
  }

  const fromPhrase = extractProductPhraseFromQuery(raw);
  if (fromPhrase) {
    filters.categoryHint = fromPhrase;
  }

  const whichSell = raw.match(WHICH_WE_SELL_RE);
  if (whichSell?.[1]) {
    const cleaned = cleanCategoryPhrase(whichSell[1]);
    if (cleaned) filters.categoryHint = cleaned;
    filters.listAll = true;
  }

  const mfr = parseManufacturerFromQuery(raw);
  if (mfr) {
    filters.manufacturer = mfr;
    filters.listAll = true;
  }

  if (
    /\b(?:all|every|each|list|find(?:\s+me)?|show(?:\s+me)?)\b/i.test(raw) &&
    /\b(?:price\s*book|pricebook|catalog|we\s+sell|our\s+(?:parts?|products?))\b/i.test(raw)
  ) {
    filters.listAll = true;
  }

  if (/\b(?:do we|we)\s+(?:\w+\s+){0,4}?(?:carry|stock|sell|offer)\b/i.test(raw)) {
    filters.listAll = true;
  }

  if (/\bwhat\s+.+\s+do we\s+(?:carry|stock|sell|offer)\b/i.test(raw)) {
    filters.listAll = true;
  }

  if (/\b(?:all|every|each)\b/i.test(raw) && filters.categoryHint) {
    filters.listAll = true;
  }

  return filters;
}

export function enrichCatalogFiltersFromTerms(
  filters: CatalogQueryFilters,
  terms: string[],
): CatalogQueryFilters {
  const next = { ...filters };
  const fromTerms = buildCategoryHintFromTerms(terms);

  if (!next.categoryHint && fromTerms) {
    next.categoryHint = fromTerms;
  } else if (next.categoryHint && fromTerms) {
    const existing = meaningfulCategoryTokens(next.categoryHint);
    const noisy = existing.some((t) => CATEGORY_TERM_STOP.has(t));
    if (noisy || existing.length === 0) {
      next.categoryHint = fromTerms;
    }
  }

  if (next.categoryHint) {
    next.categoryHint = cleanCategoryPhrase(next.categoryHint);
    if (!next.categoryHint) delete next.categoryHint;
  }

  return next;
}

export function productMatchesCategoryHint(
  fields: {
    product_name?: string | null;
    product_type?: string | null;
    product_tags?: string[] | null;
    description?: string | null;
    category?: string | null;
  },
  categoryHint: string,
): boolean {
  const hint = cleanCategoryPhrase(categoryHint);
  if (!hint) return true;

  const blob = [
    fields.product_name,
    fields.product_type,
    fields.category,
    fields.description,
    ...(fields.product_tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (hint === "camera" || hint === "cameras") {
    return CAMERA_PRODUCT_RE.test(blob);
  }

  const tokens = meaningfulCategoryTokens(hint).filter((t) => !BRAND_NAMES.has(t));
  if (tokens.length === 0) return true;

  const hasBullet = tokens.some((t) => t === "bullet" || t === "bullets");
  const hasCamera = tokens.some((t) => /^cameras?$/.test(t));

  if (hasBullet && hasCamera) {
    return tokenMatchesInBlob("bullet", blob) && CAMERA_PRODUCT_RE.test(blob);
  }

  if (tokens.length === 1) {
    return tokenMatchesProductText(tokens[0]!, blob);
  }

  const hits = tokens.filter((t) => tokenMatchesProductText(t, blob)).length;
  const required = Math.max(1, Math.ceil(tokens.length * 0.5));
  return hits >= required;
}

export function passesSalesPriceFilter(
  salesPrice: number,
  filters: Pick<CatalogQueryFilters, "maxSalesPrice" | "minSalesPrice">,
): boolean {
  const price = Number(salesPrice) || 0;
  if (filters.maxSalesPrice != null && price > filters.maxSalesPrice) return false;
  if (filters.minSalesPrice != null && price < filters.minSalesPrice) return false;
  return true;
}

export function isCatalogBrowseQuery(
  filters: CatalogQueryFilters,
  termCount: number,
): boolean {
  if (filters.listAll) return true;
  if (filters.maxSalesPrice != null || filters.minSalesPrice != null) return true;
  if (filters.categoryHint && termCount <= 6) return true;
  return false;
}

export function catalogBrowseResultLimit(filters: CatalogQueryFilters): number {
  if (filters.listAll || filters.maxSalesPrice != null || filters.minSalesPrice != null) {
    return CATALOG_LIST_ALL_CAP;
  }
  return 25;
}
