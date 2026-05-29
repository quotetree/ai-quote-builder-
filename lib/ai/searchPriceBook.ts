import type { SupabaseClient } from "@supabase/supabase-js";
import {
  smartSearchPriceBook,
  type SmartPriceBookSearchResponse,
} from "@/lib/ai/retrieval/smartPriceBookSearch";
import {
  type CatalogQueryFilters,
  catalogBrowseResultLimit,
  CATALOG_LIST_ALL_CAP,
  enrichCatalogFiltersFromTerms,
  isCatalogBrowseQuery,
  parseCatalogQueryFilters,
  passesSalesPriceFilter,
  productMatchesCategoryHint,
} from "@/lib/ai/retrieval/catalogQueryFilters";
import {
  normalizeCatalogQuery,
  passesCatalogMatchThreshold,
  scoreCatalogMatch,
} from "@/lib/ai/retrieval/catalogQueryNormalize";
import { CATALOG_TOOL_PRICE_FOOTER } from "@/lib/ai/plan/catalogPricingGrounding";
import type { Product, ProductFamily } from "@/types/database";

export interface PriceBookSearchParams {
  query: string;
  category?: string;
  manufacturer?: string;
  tags?: string[];
  /** Extra terms often describing install context / use case (searched in description + tags). */
  use_case?: string;
  max_results?: number;
  /** Inclusive ceiling on sales_price (e.g. "under $1000"). */
  max_sales_price?: number;
  /** Inclusive floor on sales_price. */
  min_sales_price?: number;
}

export interface PriceBookSearchHit {
  id: string;
  product_name: string;
  product_number: string | null;
  product_brand: string | null;
  product_type: string | null;
  category: string | null;
  product_tags: string[] | null;
  description: string | null;
  unit: string;
  list_price: number;
  sales_price: number;
  cost_price: number | null;
}

export interface PriceBookSearchResponse {
  query: string;
  total_scanned: number;
  match_count: number;
  results: PriceBookSearchHit[];
  /** True when more matches existed but were capped for context safety */
  truncated?: boolean;
  /** Complete match count before truncation */
  total_matches?: number;
  /** Smart search metadata (when available) */
  intent?: SmartPriceBookSearchResponse["intent"];
  searchStages?: string[];
  groupedResults?: SmartPriceBookSearchResponse["groupedResults"];
  categorySummary?: string[];
  expansionUsed?: boolean;
  requestedProductType?: string;
}

const PAGE_SIZE = 1000;
const MAX_SCAN = 5000;
const DEFAULT_MAX_RESULTS = 12;

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

async function fetchAllProducts(supabase: SupabaseClient): Promise<Product[]> {
  const all: Product[] = [];
  let page = 0;

  while (all.length < MAX_SCAN) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from("products")
      .select(
        "id, product_name, product_number, product_brand, product_type, product_family_id, product_tags, description, list_price, sales_price, cost_price, unit",
      )
      .order("product_name", { ascending: true })
      .range(from, to);

    if (error) throw error;
    if (!data?.length) break;

    all.push(...(data as Product[]));
    if (data.length < PAGE_SIZE) break;
    page += 1;
  }

  return all;
}

async function loadFamilyNames(
  supabase: SupabaseClient,
): Promise<Map<string, string>> {
  const { data } = await supabase.from("product_families").select("id, name");
  const map = new Map<string, string>();
  for (const row of (data ?? []) as ProductFamily[]) {
    map.set(row.id, row.name);
  }
  return map;
}

function productToHit(product: Product, familyName: string | null): PriceBookSearchHit {
  return {
    id: product.id,
    product_name: product.product_name,
    product_number: product.product_number,
    product_brand: product.product_brand,
    product_type: product.product_type,
    category: familyName ?? product.product_type,
    product_tags: product.product_tags,
    description: product.description,
    unit: product.unit,
    list_price: Number(product.list_price) || 0,
    sales_price: Number(product.sales_price) || 0,
    cost_price: product.cost_price != null ? Number(product.cost_price) : null,
  };
}

/** Load specific catalog rows by id — used for conversational "these products" follow-ups. */
export async function fetchPriceBookProductsByIds(
  supabase: SupabaseClient,
  organizationId: string,
  productIds: string[],
): Promise<PriceBookSearchResponse> {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { query: "pinned set", total_scanned: 0, match_count: 0, results: [] };
  }

  const [familyMap, { data, error }] = await Promise.all([
    loadFamilyNames(supabase),
    supabase
      .from("products")
      .select(
        "id, product_name, product_number, product_brand, product_type, product_family_id, product_tags, description, list_price, sales_price, cost_price, unit",
      )
      .eq("organization_id", organizationId)
      .in("id", uniqueIds),
  ]);

  if (error) throw error;

  const byId = new Map<string, PriceBookSearchHit>();
  for (const product of (data ?? []) as Product[]) {
    const familyName = product.product_family_id
      ? familyMap.get(product.product_family_id) ?? null
      : null;
    byId.set(product.id, productToHit(product, familyName));
  }

  // Preserve order from prior assistant list
  const results = uniqueIds
    .map((id) => byId.get(id))
    .filter((h): h is PriceBookSearchHit => !!h);

  return {
    query: "pinned prior result set",
    total_scanned: uniqueIds.length,
    match_count: results.length,
    total_matches: results.length,
    results,
  };
}

export function formatPinnedResultSetForPrompt(
  search: PriceBookSearchResponse,
  options: { priorLabel?: string; userQuestion?: string },
): string {
  const header = [
    "--- PINNED PRICE BOOK RESULT SET (from your previous answer — authoritative) ---",
    options.priorLabel
      ? `These ${search.match_count} product(s) are from the prior turn: "${options.priorLabel}".`
      : `These ${search.match_count} product(s) are from your immediately previous answer.`,
    options.userQuestion
      ? `Current follow-up: "${options.userQuestion}" — answer ONLY for these rows. Do NOT run a new broad catalog search.`
      : "Answer ONLY for these rows. Do NOT run a new broad catalog search.",
    "Copy exact names, SKUs, and **Sales (catalog)** prices. For margin: use Cost and Sales when cost is present.",
  ].join("\n");

  if (search.match_count === 0) {
    return `${header}\n\nNo pinned products could be loaded from the prior answer. Ask the user to repeat the original search.`;
  }

  return `${header}\n\n${formatPriceBookResultsForPrompt(search)}`;
}

function normalizeTerms(...parts: (string | undefined)[]): string[] {
  const combined = parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return [...new Set(combined)];
}

function productSearchableText(
  product: Product,
  familyName: string | null,
  extraTerms: string[],
): string {
  return [
    product.product_name,
    product.product_number,
    product.product_brand,
    product.product_type,
    familyName,
    product.description,
    ...(product.product_tags ?? []),
    ...extraTerms,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesFilters(
  product: Product,
  familyName: string | null,
  params: PriceBookSearchParams,
  catalogFilters?: CatalogQueryFilters,
): boolean {
  const salesPrice = Number(product.sales_price) || 0;
  if (
    !passesSalesPriceFilter(salesPrice, {
      maxSalesPrice: params.max_sales_price ?? catalogFilters?.maxSalesPrice,
      minSalesPrice: params.min_sales_price ?? catalogFilters?.minSalesPrice,
    })
  ) {
    return false;
  }

  const categoryHint =
    params.category?.trim() || catalogFilters?.categoryHint;
  if (categoryHint) {
    if (
      !productMatchesCategoryHint(
        {
          product_name: product.product_name,
          product_type: product.product_type,
          product_tags: product.product_tags,
          description: product.description,
          category: familyName ?? product.product_type,
        },
        categoryHint,
      )
    ) {
      return false;
    }
  } else if (params.category?.trim()) {
    const cat = params.category.trim().toLowerCase();
    const type = (product.product_type ?? "").toLowerCase();
    const family = (familyName ?? "").toLowerCase();
    if (!type.includes(cat) && !family.includes(cat)) return false;
  }

  const mfr =
    params.manufacturer?.trim().toLowerCase() ||
    catalogFilters?.manufacturer?.trim().toLowerCase();
  if (mfr) {
    const brand = (product.product_brand ?? "").toLowerCase();
    const name = (product.product_name ?? "").toLowerCase();
    if (!brand.includes(mfr) && !name.includes(mfr)) return false;
  }

  if (params.tags?.length) {
    const tagBlob = (product.product_tags ?? []).join(" ").toLowerCase();
    for (const tag of params.tags) {
      if (tag.trim() && !tagBlob.includes(tag.trim().toLowerCase())) return false;
    }
  }

  return true;
}

export function mergeCatalogFilters(
  params: PriceBookSearchParams,
  rawQuery: string,
  searchTerms: string[] = [],
): { params: PriceBookSearchParams; filters: CatalogQueryFilters } {
  const parsed = enrichCatalogFiltersFromTerms(
    parseCatalogQueryFilters(rawQuery),
    searchTerms,
  );
  const browseLimit = catalogBrowseResultLimit(parsed);
  const isBrowse = isCatalogBrowseQuery(parsed, searchTerms.length);

  return {
    filters: parsed,
    params: {
      ...params,
      category: params.category || parsed.categoryHint,
      manufacturer:
        params.manufacturer || parsed.manufacturer,
      max_sales_price: params.max_sales_price ?? parsed.maxSalesPrice,
      min_sales_price: params.min_sales_price ?? parsed.minSalesPrice,
      max_results: isBrowse
        ? Math.max(params.max_results ?? 0, browseLimit)
        : params.max_results,
    },
  };
}

/** Scan entire org catalog with category + price filters (no fuzzy term gate). */
export async function browsePriceBookByFilters(
  supabase: SupabaseClient,
  organizationId: string,
  params: PriceBookSearchParams,
  catalogFilters: CatalogQueryFilters,
): Promise<PriceBookSearchResponse> {
  const cap = Math.min(
    Math.max(params.max_results ?? CATALOG_LIST_ALL_CAP, 1),
    CATALOG_LIST_ALL_CAP,
  );
  const familyMap = await loadFamilyNames(supabase);
  const PAGE_SIZE = 1000;
  const matches: PriceBookSearchHit[] = [];
  let total_scanned = 0;
  let page = 0;

  while (true) {
    const from = page * PAGE_SIZE;
    const { data } = await supabase
      .from("products")
      .select(
        "id, product_name, product_number, product_brand, product_type, product_family_id, product_tags, description, list_price, sales_price, cost_price, unit",
      )
      .eq("organization_id", organizationId)
      .order("product_name", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (!data?.length) break;
    total_scanned += data.length;

    for (const product of data as Product[]) {
      const familyName = product.product_family_id
        ? familyMap.get(product.product_family_id) ?? null
        : null;
      if (!matchesFilters(product, familyName, params, catalogFilters)) continue;

      matches.push({
        id: product.id,
        product_name: product.product_name,
        product_number: product.product_number,
        product_brand: product.product_brand,
        product_type: product.product_type,
        category: familyName ?? product.product_type,
        product_tags: product.product_tags,
        description: product.description,
        unit: product.unit,
        list_price: Number(product.list_price) || 0,
        sales_price: Number(product.sales_price) || 0,
        cost_price: product.cost_price != null ? Number(product.cost_price) : null,
      });
    }

    if (data.length < PAGE_SIZE) break;
    page += 1;
  }

  matches.sort((a, b) => {
    const priceDiff = a.sales_price - b.sales_price;
    if (priceDiff !== 0) return priceDiff;
    return a.product_name.localeCompare(b.product_name);
  });

  const total_matches = matches.length;
  const truncated = total_matches > cap;
  const results = matches.slice(0, cap);

  return {
    query: params.query,
    total_scanned,
    match_count: results.length,
    total_matches,
    truncated,
    results,
  };
}

export async function searchPriceBook(
  supabase: SupabaseClient,
  params: PriceBookSearchParams,
  options?: { organizationId?: string },
): Promise<PriceBookSearchResponse> {
  const query = params.query?.trim() ?? "";
  if (!query) {
    return { query: "", total_scanned: 0, match_count: 0, results: [] };
  }

  const normalized = normalizeCatalogQuery(query);
  const { params: mergedParams, filters } = mergeCatalogFilters(
    params,
    query,
    normalized.terms,
  );
  const categoryBrowse = isCatalogBrowseQuery(filters, normalized.terms.length);
  const maxResults = categoryBrowse
    ? Math.min(Math.max(mergedParams.max_results ?? CATALOG_LIST_ALL_CAP, 1), CATALOG_LIST_ALL_CAP)
    : Math.min(Math.max(mergedParams.max_results ?? DEFAULT_MAX_RESULTS, 1), 25);

  if (options?.organizationId) {
    const smart = await smartSearchPriceBook(supabase, options.organizationId, {
      ...mergedParams,
      max_results: maxResults,
    });
    return {
      query,
      total_scanned: smart.total_scanned,
      match_count: smart.match_count,
      total_matches: smart.total_matches,
      truncated: smart.truncated,
      results: smart.results,
      intent: smart.intent,
      searchStages: smart.searchStages,
      groupedResults: smart.groupedResults,
      categorySummary: smart.categorySummary,
      expansionUsed: smart.expansionUsed,
      requestedProductType: smart.requestedProductType,
    };
  }

  const normalizedMerged = normalizeCatalogQuery(
    [mergedParams.query, mergedParams.use_case].filter(Boolean).join(" "),
  );
  const [products, familyMap] = await Promise.all([
    fetchAllProducts(supabase),
    loadFamilyNames(supabase),
  ]);

  const categoryBrowseLocal = isCatalogBrowseQuery(filters, normalizedMerged.terms.length);

  const scored: { hit: PriceBookSearchHit; score: number }[] = [];
  const mfr = mergedParams.manufacturer?.trim() || normalizedMerged.manufacturer;

  for (const product of products) {
    const familyName = product.product_family_id
      ? familyMap.get(product.product_family_id) ?? null
      : null;

    if (
      !matchesFilters(
        product,
        familyName,
        { ...mergedParams, manufacturer: mfr },
        filters,
      )
    ) {
      continue;
    }

    const text = productSearchableText(product, familyName, []);
    const score = scoreCatalogMatch(text, normalizedMerged.terms, {
      manufacturer: mfr,
      brandField: product.product_brand ?? "",
    });
    if (
      !passesCatalogMatchThreshold(score, normalizedMerged.terms.length, {
        categoryBrowse: categoryBrowseLocal,
      })
    ) {
      continue;
    }

    scored.push({
      hit: {
      id: product.id,
      product_name: product.product_name,
      product_number: product.product_number,
      product_brand: product.product_brand,
      product_type: product.product_type,
      category: familyName ?? product.product_type,
      product_tags: product.product_tags,
      description: product.description,
      unit: product.unit,
      list_price: Number(product.list_price) || 0,
      sales_price: Number(product.sales_price) || 0,
      cost_price: product.cost_price != null ? Number(product.cost_price) : null,
      },
      score,
    });
  }

  const hits = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.hit);

  return {
    query,
    total_scanned: products.length,
    match_count: hits.length,
    results: hits,
  };
}

export function formatPriceBookResultsForPrompt(search: PriceBookSearchResponse): string {
  if (search.match_count === 0) {
    return [
      `No price book products matched "${search.query}" after multi-stage retrieval (searched ${search.total_scanned} catalog items).`,
      search.searchStages?.length
        ? `Stages tried: ${search.searchStages.join(" → ")}.`
        : "",
      "**Response rule:** Do NOT say a generic \"couldn't find anything.\" Instead: (1) confirm the catalog was searched, (2) suggest alternate terms (SKU, brand, broader category), (3) offer to search related categories (e.g. structured cabling, patch panels).",
      "If you have not called search_price_book yet, call it with the core product term only (e.g. query: \"cat6\", category: \"cat6\").",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const total = search.total_matches ?? search.match_count;
  const lines = [
    `Price book search: "${search.query}" — **${total}** matching product(s) (showing ${search.match_count}).`,
    search.intent ? `Intent: **${search.intent.replace(/_/g, " ")}**.` : "",
    search.categorySummary?.length
      ? `Categories found: ${search.categorySummary.join(", ")}.`
      : "",
    search.expansionUsed
      ? "**Note:** Results include related category matches (e.g. patch panels, keystones) — the user may have used a broad term like \"cables.\" Explain what was found vs. what they asked for."
      : "",
    "**AUTHORITATIVE PRICES** — Only quote the **Sales (catalog)** column below. Never substitute list price, web MSRP, or an estimated price.",
    search.truncated
      ? `**Note:** ${total - search.match_count} additional match(es) omitted (safety cap ${CATALOG_LIST_ALL_CAP}). Narrow the query or export from Price Book for the full list.`
      : total > search.match_count
        ? `Showing top ${search.match_count} of ${total} matches.`
        : "**COMPLETE LIST** — include **every row below** in your answer. Do not summarize or show only a sample.",
    "",
  ].filter(Boolean);

  if (search.match_count > 12) {
    lines.push("| Product | SKU | Sales (catalog) | List | Margin % |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const p of search.results) {
      const sku = p.product_number ?? "—";
      const margin =
        p.cost_price != null && p.sales_price > 0
          ? `${(((p.sales_price - p.cost_price) / p.sales_price) * 100).toFixed(1)}%`
          : "—";
      lines.push(
        `| ${p.product_name} [pricebook:${p.id}] | ${sku} | **${formatMoney(p.sales_price)}** | ${formatMoney(p.list_price)} | ${margin} |`,
      );
    }
  } else {
    for (const p of search.results) {
      const parts = [
        `**${p.product_name}** [pricebook:${p.id}]`,
        p.product_number ? `SKU: ${p.product_number}` : null,
        p.product_brand ? `Brand: ${p.product_brand}` : null,
        p.category ? `Family: ${p.category}` : null,
        p.product_type ? `Type: ${p.product_type}` : null,
        p.product_tags?.length ? `Tags: ${p.product_tags.join(", ")}` : null,
      ].filter(Boolean);

      lines.push(`- ${parts.join(" | ")}`);
      const marginPct =
        p.cost_price != null && p.sales_price > 0
          ? (((p.sales_price - p.cost_price) / p.sales_price) * 100).toFixed(1)
          : null;
      lines.push(
        `  **Sales (catalog — quote this): ${formatMoney(p.sales_price)}** | List: ${formatMoney(p.list_price)}${
          p.cost_price != null ? ` | Cost: ${formatMoney(p.cost_price)}` : ""
        }${marginPct != null ? ` | Est. margin: ${marginPct}%` : ""} | Unit: ${p.unit}`,
      );
      if (p.description?.trim()) {
        lines.push(`  Description: ${p.description.trim().slice(0, 200)}`);
      }
      lines.push("");
    }
  }

  lines.push(
    "To add any item to the active estimate, tell the user to add it in Drive via the spreadsheet product picker (not through this chat).",
    "",
    CATALOG_TOOL_PRICE_FOOTER,
  );

  return lines.join("\n").trim();
}
