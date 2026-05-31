import type { Product } from "@/types/database";

/** Multi-term AND search over name, SKU, description, brand, type, and tags. */
export function filterProducts(products: Product[], query: string): Product[] {
  const q = query.trim();
  if (!q) return [];
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return [];
  return products.filter((p) => {
    const text = [
      p.product_name,
      p.product_number,
      p.description,
      p.product_brand,
      p.product_type,
      ...(p.product_tags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((t) => text.includes(t));
  });
}

/** Same as SpreadsheetEditor product picker — catalog order preserved, optional limit. */
export function searchProductsInCatalog(
  products: Product[],
  query: string,
  maxResults?: number,
): Product[] {
  const hits = filterProducts(products, query);
  return maxResults != null ? hits.slice(0, maxResults) : hits;
}

/** Strip qty, discount phrasing, and request filler from build-mode search text. */
export function normalizeBuildSearchQuery(raw: string): string {
  return raw
    .replace(/\$[\d,]+(?:\.\d+)?/g, "")
    .replace(/\bat\s+(?:a\s+)?\d+(?:\.\d+)?%?\s*(?:discount|off)\b/gi, "")
    .replace(/\bwith\s+\d+(?:\.\d+)?%?\s*(?:discount|off)\b/gi, "")
    .replace(/\b(i need|i want|please add|add|get|quote|include|order)\b/gi, " ")
    .replace(/\bin\b/gi, " ")
    .replace(/^\d+[\d,.]*\s*/, "")
    .replace(/\b(ea|each|units?|boxes?|box|pcs?|licenses?|license|ls|ft|lf)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function appendQueryAttempts(out: string[], seen: Set<string>, base: string) {
  const trimmed = base.trim();
  if (!trimmed) return;

  const words = trimmed.split(/\s+/).filter(Boolean);
  for (let len = words.length; len >= 1; len -= 1) {
    const candidate = words.slice(0, len).join(" ");
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
}

/**
 * Ordered queries for build-mode auto-match. Uses the first query that returns hits,
 * mirroring typing progressively shorter text in the spreadsheet search box.
 * Never tries isolated trailing words from unrelated fallbacks.
 */
export function productSearchQueryAttempts(
  searchQuery: string,
  requestedLabel: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const base of [
    searchQuery,
    normalizeBuildSearchQuery(searchQuery),
    requestedLabel,
    normalizeBuildSearchQuery(requestedLabel),
  ]) {
    if (base?.trim()) appendQueryAttempts(out, seen, base);
  }

  return out;
}

/** First spreadsheet-style query that matches; catalog order preserved. */
export function searchProductsForBuildItem(
  products: Product[],
  searchQuery: string,
  requestedLabel: string,
  maxResults = 3,
): Product[] {
  for (const query of productSearchQueryAttempts(searchQuery, requestedLabel)) {
    const hits = filterProducts(products, query);
    if (hits.length > 0) return hits.slice(0, maxResults);
  }
  return [];
}
