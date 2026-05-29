/**
 * Catalog search intelligence: term normalization, synonym expansion,
 * generic-word stripping, and intent detection.
 */

export type CatalogSearchIntent =
  | "inventory_lookup"
  | "price_lookup"
  | "margin_analysis"
  | "sku_lookup"
  | "compare"
  | "general";

/** Words users say that are not literal product-type tokens in the DB */
export const GENERIC_PRODUCT_TERMS = new Set([
  "cable",
  "cables",
  "wire",
  "wires",
  "product",
  "products",
  "item",
  "items",
  "part",
  "parts",
  "sku",
  "skus",
  "equipment",
  "device",
  "devices",
  "component",
  "components",
  "option",
  "options",
  "type",
  "types",
  "kind",
  "kinds",
  "different",
  "various",
  "variety",
  "stuff",
  "things",
  "something",
  "anything",
  "everything",
  "related",
  "similar",
  "other",
  "others",
  "line",
  "lines",
  "model",
  "models",
  "version",
  "versions",
  "variant",
  "variants",
]);

/** Normalize technical tokens before matching */
const TECHNICAL_ALIASES: [RegExp, string][] = [
  [/\bcat[\s-]?6\b/gi, "cat6"],
  [/\bcat[\s-]?5e?\b/gi, "cat5e"],
  [/\bcat[\s-]?5\b/gi, "cat5"],
  [/\bpoe\+?\b/gi, "poe"],
  [/\bwi[\s-]?fi\b/gi, "wifi"],
  [/\baccess[\s-]?control\b/gi, "accesscontrol"],
  [/\blow[\s-]?voltage\b/gi, "lowvoltage"],
  [/\bmulti[\s-]?sensor\b/gi, "multisensor"],
];

/** When user says X, also search for related product vocabulary */
const SEMANTIC_EXPANSIONS: Record<string, string[]> = {
  cable: [
    "cable",
    "patch",
    "patch panel",
    "keystone",
    "jack",
    "spool",
    "plenum",
    "riser",
    "utp",
    "ftp",
    "structured",
    "ethernet",
    "twisted",
    "pair",
    "horizontal",
    "backbone",
  ],
  cables: [
    "cable",
    "patch",
    "patch panel",
    "keystone",
    "jack",
    "spool",
    "plenum",
    "riser",
    "utp",
    "ftp",
    "structured",
    "ethernet",
    "twisted",
    "pair",
  ],
  cat6: ["cat6", "c6", "category6", "category 6"],
  cat5e: ["cat5e", "cat5", "c5"],
  camera: ["camera", "dome", "bullet", "ptz", "multisensor", "fisheye", "nvr", "encoder"],
  cameras: ["camera", "dome", "bullet", "ptz", "multisensor", "fisheye", "nvr", "encoder"],
  reader: ["reader", "card reader", "credential", "access"],
  readers: ["reader", "card reader", "credential", "access"],
  gateway: ["gateway", "router", "cellular", "lte", "modem", "bridge"],
  gateways: ["gateway", "router", "cellular", "lte", "modem", "bridge"],
  switch: ["switch", "poe", "network"],
  switches: ["switch", "poe", "network"],
  fiber: ["fiber", "fibre", "sfp", "lc", "sc", "fusion", "splice", "optic"],
  tool: ["tool", "tester", "crimp", "strip", "punch", "toner"],
  tools: ["tool", "tester", "crimp", "strip", "punch", "toner"],
};

export interface ExpandedCatalogTerms {
  /** Original normalized terms (non-stop) */
  allTerms: string[];
  /** Terms that must drive matching (excludes generic product words) */
  coreTerms: string[];
  /** Generic terms stripped from strict AND matching */
  genericTerms: string[];
  /** Flattened expansion vocabulary for related matches */
  expansionTerms: string[];
  /** Text for embedding / semantic search */
  semanticText: string;
  /** Category hint using core terms only */
  coreCategoryHint: string;
  intent: CatalogSearchIntent;
  /** Alternate query strings to try in cascade */
  cascadeQueries: string[];
}

export function normalizeTechnicalText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TECHNICAL_ALIASES) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, " ").trim();
}

export function isGenericProductTerm(term: string): boolean {
  return GENERIC_PRODUCT_TERMS.has(term.toLowerCase());
}

export function splitCoreAndGenericTerms(terms: string[]): {
  coreTerms: string[];
  genericTerms: string[];
} {
  const coreTerms: string[] = [];
  const genericTerms: string[] = [];
  for (const t of terms) {
    if (isGenericProductTerm(t)) genericTerms.push(t);
    else coreTerms.push(t);
  }
  return { coreTerms, genericTerms };
}

export function expandTermsForSearch(terms: string[]): string[] {
  const expanded = new Set<string>();
  for (const term of terms) {
    const lower = term.toLowerCase();
    expanded.add(lower);
    const group = SEMANTIC_EXPANSIONS[lower];
    if (group) {
      for (const alias of group) expanded.add(alias.toLowerCase());
    }
  }
  return [...expanded];
}

export function extractCatalogIntent(raw: string): CatalogSearchIntent {
  const msg = raw.trim().toLowerCase();
  if (!msg) return "general";

  if (/\b(margin|markup|profit|gp\b|gross)\b/i.test(msg)) return "margin_analysis";
  if (/\b(compare|versus|vs\.?|difference between)\b/i.test(msg)) return "compare";
  if (/\b(sku|product\s*(?:#|number|code)|part\s*(?:#|number))\b/i.test(msg)) {
    return "sku_lookup";
  }
  if (/\b(how much|price|pricing|cost|sell(?:s|ing)?\s+(?:for|at))\b/i.test(msg)) {
    return "price_lookup";
  }
  if (
    /\b(?:all|every|each|list|find|show|what\s+.+\s+(?:do we|we)\s+(?:carry|sell|stock))\b/i.test(
      msg,
    )
  ) {
    return "inventory_lookup";
  }
  return "general";
}

export function expandCatalogSearchTerms(
  raw: string,
  normalizedTerms: string[],
): ExpandedCatalogTerms {
  const intent = extractCatalogIntent(raw);
  const normalizedRaw = normalizeTechnicalText(raw);
  const { coreTerms, genericTerms } = splitCoreAndGenericTerms(normalizedTerms);

  const expansionTerms = expandTermsForSearch([...coreTerms, ...genericTerms]);
  const coreCategoryHint = coreTerms.join(" ").trim();

  const semanticParts = [
    coreCategoryHint,
    ...genericTerms.filter((t) => SEMANTIC_EXPANSIONS[t]),
    ...expansionTerms.slice(0, 12),
  ];
  const semanticText = [...new Set(semanticParts.filter(Boolean))].join(" ").trim();

  const cascadeQueries = [
    coreCategoryHint,
    coreTerms.join(" "),
    normalizedTerms.join(" "),
    semanticText,
    coreTerms[0] ?? "",
  ].filter((q, i, arr) => q.trim().length > 0 && arr.indexOf(q) === i);

  return {
    allTerms: normalizedTerms,
    coreTerms,
    genericTerms,
    expansionTerms,
    semanticText: semanticText || normalizedTerms.join(" "),
    coreCategoryHint,
    intent,
    cascadeQueries,
  };
}

/** Token match with normalization, singular/plural, and embedded SKU patterns */
export function tokenMatchesProductText(token: string, productText: string): boolean {
  const hay = normalizeTechnicalText(productText.toLowerCase());
  const t = token.toLowerCase();

  if (hay.includes(t)) return true;

  // cat6 ↔ C6 in SKUs (e.g. C6PP24)
  if (t === "cat6" && /\bc6\b|c6pp|c6-/i.test(hay)) return true;
  if (t === "c6" && /\bcat6\b/i.test(hay)) return true;

  // Singular/plural
  if (t.endsWith("s") && t.length > 2) {
    const singular = t.slice(0, -1);
    if (hay.includes(singular)) return true;
  } else if (hay.includes(`${t}s`)) return true;

  // Expansion group partial match
  const group = SEMANTIC_EXPANSIONS[t];
  if (group) {
    for (const alias of group) {
      if (hay.includes(alias.toLowerCase())) return true;
    }
  }

  return false;
}

export function scoreExpandedCatalogMatch(
  productText: string,
  expanded: ExpandedCatalogTerms,
  options?: { manufacturer?: string; brandField?: string },
): { score: number; confidence: "high" | "medium" | "low"; matchedTerms: string[] } {
  const hay = normalizeTechnicalText(productText.toLowerCase());
  const brand = (options?.brandField ?? "").toLowerCase();

  if (options?.manufacturer) {
    const mfr = options.manufacturer.toLowerCase();
    if (!brand.includes(mfr) && !hay.includes(mfr)) {
      return { score: 0, confidence: "low", matchedTerms: [] };
    }
  }

  const matchedCore: string[] = [];
  for (const term of expanded.coreTerms) {
    if (tokenMatchesProductText(term, hay)) matchedCore.push(term);
  }

  const matchedExpansion: string[] = [];
  for (const term of expanded.expansionTerms) {
    if (tokenMatchesProductText(term, hay) && !matchedCore.includes(term)) {
      matchedExpansion.push(term);
    }
  }

  const coreCount = expanded.coreTerms.length;
  if (coreCount > 0 && matchedCore.length === 0) {
    // No core match — only accept strong expansion hits
    if (matchedExpansion.length >= 2) {
      return {
        score: 0.35 + matchedExpansion.length * 0.05,
        confidence: "low",
        matchedTerms: matchedExpansion,
      };
    }
    return { score: 0, confidence: "low", matchedTerms: [] };
  }

  const coreRatio = coreCount > 0 ? matchedCore.length / coreCount : 1;
  let score = coreRatio * 0.7 + Math.min(matchedExpansion.length * 0.05, 0.3);

  if (options?.manufacturer && matchedCore.length >= 1) {
    score = Math.max(score, 0.55);
  }

  let confidence: "high" | "medium" | "low" = "low";
  if (coreRatio >= 1 || (coreRatio >= 0.5 && matchedCore.length >= 1)) {
    confidence = matchedExpansion.length > 0 || coreRatio >= 1 ? "high" : "medium";
  } else if (matchedCore.length >= 1 || matchedExpansion.length >= 2) {
    confidence = "medium";
  }

  return {
    score,
    confidence,
    matchedTerms: [...matchedCore, ...matchedExpansion],
  };
}

export function passesExpandedMatchThreshold(
  score: number,
  expanded: ExpandedCatalogTerms,
  options?: { inventoryLookup?: boolean; categoryBrowse?: boolean },
): boolean {
  if (score <= 0) return false;
  const coreCount = expanded.coreTerms.length;

  if (options?.inventoryLookup || options?.categoryBrowse) {
    if (coreCount === 0) return score >= 0.25;
    return score >= 0.35;
  }
  if (coreCount <= 1) return score >= 0.4;
  if (coreCount <= 3) return score >= 0.45;
  return score >= 0.4;
}

/** Summarize distinct categories from hits for grouped responses */
export function summarizeResultCategories(
  hits: { product_type: string | null; category: string | null }[],
): string[] {
  const cats = new Set<string>();
  for (const h of hits) {
    if (h.category?.trim()) cats.add(h.category.trim());
    else if (h.product_type?.trim()) cats.add(h.product_type.trim());
  }
  return [...cats].sort().slice(0, 8);
}
