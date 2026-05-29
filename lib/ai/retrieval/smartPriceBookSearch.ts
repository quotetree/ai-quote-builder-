import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product, ProductFamily } from "@/types/database";
import { buildProductEmbeddingText } from "@/lib/ai/embeddings/embeddingText";
import { embedQuery } from "@/lib/ai/embeddings/embedQuery";
import { isHybridRetrievalEnabled } from "@/lib/ai/documentProcessingConfig";
import {
  expandCatalogSearchTerms,
  passesExpandedMatchThreshold,
  scoreExpandedCatalogMatch,
  summarizeResultCategories,
  type CatalogSearchIntent,
  type ExpandedCatalogTerms,
} from "@/lib/ai/retrieval/catalogQueryExpand";
import {
  enrichCatalogFiltersFromTerms,
  parseCatalogQueryFilters,
  passesSalesPriceFilter,
  type CatalogQueryFilters,
} from "@/lib/ai/retrieval/catalogQueryFilters";
import { normalizeCatalogQuery } from "@/lib/ai/retrieval/catalogQueryNormalize";
import {
  browsePriceBookByFilters,
  mergeCatalogFilters,
  type PriceBookSearchHit,
  type PriceBookSearchParams,
  type PriceBookSearchResponse,
} from "@/lib/ai/searchPriceBook";

export type MatchConfidence = "high" | "medium" | "low";

export interface ScoredPriceBookHit extends PriceBookSearchHit {
  confidence: MatchConfidence;
  matchScore: number;
  matchedTerms: string[];
}

export interface SmartPriceBookSearchResponse extends PriceBookSearchResponse {
  intent: CatalogSearchIntent;
  searchStages: string[];
  groupedResults: {
    high: ScoredPriceBookHit[];
    medium: ScoredPriceBookHit[];
    low: ScoredPriceBookHit[];
  };
  categorySummary: string[];
  expansionUsed: boolean;
  requestedProductType?: string;
}

const PAGE_SIZE = 1000;
const MAX_SCAN = 5000;

interface SemanticProductRow {
  id: string;
  product_name: string;
  product_number: string | null;
  product_brand: string | null;
  product_type: string | null;
  product_tags: string[] | null;
  description: string | null;
  list_price: number;
  sales_price: number;
  cost_price: number | null;
  unit: string;
  similarity: number;
}

function rowToHit(row: Product | SemanticProductRow, familyName: string | null): PriceBookSearchHit {
  return {
    id: row.id,
    product_name: row.product_name,
    product_number: row.product_number,
    product_brand: row.product_brand,
    product_type: row.product_type,
    category: familyName ?? row.product_type,
    product_tags: row.product_tags,
    description: row.description,
    unit: row.unit,
    list_price: Number(row.list_price) || 0,
    sales_price: Number(row.sales_price) || 0,
    cost_price: row.cost_price != null ? Number(row.cost_price) : null,
  };
}

function productSearchableText(product: Product, familyName: string | null): string {
  return buildProductEmbeddingText(product, familyName);
}

function matchesPriceAndMfrFilters(
  hit: PriceBookSearchHit,
  params: PriceBookSearchParams,
  catalogFilters: CatalogQueryFilters,
  manufacturer?: string,
): boolean {
  if (
    !passesSalesPriceFilter(hit.sales_price, {
      maxSalesPrice: params.max_sales_price ?? catalogFilters.maxSalesPrice,
      minSalesPrice: params.min_sales_price ?? catalogFilters.minSalesPrice,
    })
  ) {
    return false;
  }

  const mfr = params.manufacturer?.trim() || catalogFilters.manufacturer || manufacturer;
  if (mfr) {
    const brand = (hit.product_brand ?? "").toLowerCase();
    const name = (hit.product_name ?? "").toLowerCase();
    if (!brand.includes(mfr.toLowerCase()) && !name.includes(mfr.toLowerCase())) {
      return false;
    }
  }

  if (params.tags?.length) {
    const tagBlob = (hit.product_tags ?? []).join(" ").toLowerCase();
    for (const tag of params.tags) {
      if (tag.trim() && !tagBlob.includes(tag.trim().toLowerCase())) return false;
    }
  }

  return true;
}

function scoreProduct(
  product: Product,
  familyName: string | null,
  expanded: ExpandedCatalogTerms,
  manufacturer?: string,
): { hit: PriceBookSearchHit; score: number; confidence: MatchConfidence; matchedTerms: string[] } {
  const text = productSearchableText(product, familyName);
  const result = scoreExpandedCatalogMatch(text, expanded, {
    manufacturer,
    brandField: product.product_brand ?? "",
  });
  return {
    hit: rowToHit(product, familyName),
    score: result.score,
    confidence: result.confidence,
    matchedTerms: result.matchedTerms,
  };
}

async function loadFamilyMap(supabase: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data } = await supabase.from("product_families").select("id, name");
  for (const row of (data ?? []) as ProductFamily[]) {
    map.set(row.id, row.name);
  }
  return map;
}

async function scanAndScoreProducts(
  supabase: SupabaseClient,
  organizationId: string,
  expanded: ExpandedCatalogTerms,
  params: PriceBookSearchParams,
  catalogFilters: CatalogQueryFilters,
  manufacturer: string | undefined,
  options: { inventoryLookup?: boolean; minScore?: number },
): Promise<ScoredPriceBookHit[]> {
  const familyMap = await loadFamilyMap(supabase);
  const scored: ScoredPriceBookHit[] = [];
  let page = 0;

  while (page * PAGE_SIZE < MAX_SCAN) {
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

    for (const product of data as Product[]) {
      const familyName = product.product_family_id
        ? familyMap.get(product.product_family_id) ?? null
        : null;
      const { hit, score, confidence, matchedTerms } = scoreProduct(
        product,
        familyName,
        expanded,
        manufacturer,
      );

      if (
        !passesExpandedMatchThreshold(score, expanded, {
          inventoryLookup: options.inventoryLookup,
          categoryBrowse: true,
        })
      ) {
        continue;
      }
      if (options.minScore != null && score < options.minScore) continue;
      if (!matchesPriceAndMfrFilters(hit, params, catalogFilters, manufacturer)) continue;

      scored.push({ ...hit, matchScore: score, confidence, matchedTerms });
    }

    if (data.length < PAGE_SIZE) break;
    page += 1;
  }

  return scored.sort((a, b) => b.matchScore - a.matchScore);
}

async function trySemanticSearch(
  supabase: SupabaseClient,
  organizationId: string,
  semanticText: string,
  expanded: ExpandedCatalogTerms,
  params: PriceBookSearchParams,
  catalogFilters: CatalogQueryFilters,
  manufacturer: string | undefined,
  familyMap: Map<string, string>,
): Promise<ScoredPriceBookHit[]> {
  if (!isHybridRetrievalEnabled()) return [];

  const queryEmbedding = await embedQuery(semanticText);
  if (!queryEmbedding) return [];

  const { data: matches } = await supabase.rpc("match_products", {
    query_embedding: queryEmbedding,
    match_organization_id: organizationId,
    match_count: 50,
    match_threshold: parseFloat(process.env.SEMANTIC_MATCH_THRESHOLD ?? "0.15"),
  });

  const semanticRows = (matches ?? []) as SemanticProductRow[];
  if (semanticRows.length === 0) return [];

  const { data: familyRows } = await supabase
    .from("products")
    .select("id, product_family_id")
    .in("id", semanticRows.map((r) => r.id));

  const familyByProduct = new Map<string, string | null>();
  for (const fr of familyRows ?? []) {
    const fid = fr.product_family_id as string | null;
    familyByProduct.set(fr.id as string, fid ? familyMap.get(fid) ?? null : null);
  }

  const scored: ScoredPriceBookHit[] = [];
  for (const row of semanticRows) {
    const familyName = familyByProduct.get(row.id) ?? null;
    const hit = rowToHit(row, familyName);
    if (!matchesPriceAndMfrFilters(hit, params, catalogFilters, manufacturer)) continue;

    const text = buildProductEmbeddingText(row, hit.category);
    const kw = scoreExpandedCatalogMatch(text, expanded, {
      manufacturer,
      brandField: row.product_brand ?? "",
    });
    const combined = 0.6 * row.similarity + 0.4 * kw.score;
    if (combined < 0.2 && kw.score < 0.35) continue;

    scored.push({
      ...hit,
      matchScore: combined,
      confidence: kw.confidence === "high" ? "high" : row.similarity > 0.35 ? "medium" : "low",
      matchedTerms: kw.matchedTerms,
    });
  }

  return scored.sort((a, b) => b.matchScore - a.matchScore);
}

function dedupeScoredHits(hits: ScoredPriceBookHit[]): ScoredPriceBookHit[] {
  const byId = new Map<string, ScoredPriceBookHit>();
  for (const hit of hits) {
    const existing = byId.get(hit.id);
    if (!existing || hit.matchScore > existing.matchScore) {
      byId.set(hit.id, hit);
    }
  }
  return [...byId.values()].sort((a, b) => b.matchScore - a.matchScore);
}

function groupByConfidence(hits: ScoredPriceBookHit[]): SmartPriceBookSearchResponse["groupedResults"] {
  const high: ScoredPriceBookHit[] = [];
  const medium: ScoredPriceBookHit[] = [];
  const low: ScoredPriceBookHit[] = [];
  for (const h of hits) {
    if (h.confidence === "high") high.push(h);
    else if (h.confidence === "medium") medium.push(h);
    else low.push(h);
  }
  return { high, medium, low };
}

function buildResponse(
  query: string,
  expanded: ExpandedCatalogTerms,
  hits: ScoredPriceBookHit[],
  totalScanned: number,
  searchStages: string[],
  maxResults: number,
  expansionUsed: boolean,
): SmartPriceBookSearchResponse {
  const deduped = dedupeScoredHits(hits);
  const total_matches = deduped.length;
  const truncated = total_matches > maxResults;
  const results = deduped.slice(0, maxResults);
  const grouped = groupByConfidence(deduped);

  return {
    query,
    total_scanned: totalScanned,
    match_count: results.length,
    total_matches,
    truncated,
    results,
    intent: expanded.intent,
    searchStages,
    groupedResults: grouped,
    categorySummary: summarizeResultCategories(deduped),
    expansionUsed,
    requestedProductType: expanded.genericTerms[0],
  };
}

/**
 * Multi-stage price book retrieval — never fails on first exact-match miss.
 */
export async function smartSearchPriceBook(
  supabase: SupabaseClient,
  organizationId: string,
  params: PriceBookSearchParams,
): Promise<SmartPriceBookSearchResponse> {
  const query = params.query?.trim() ?? "";
  if (!query) {
    return {
      query: "",
      total_scanned: 0,
      match_count: 0,
      results: [],
      intent: "general",
      searchStages: [],
      groupedResults: { high: [], medium: [], low: [] },
      categorySummary: [],
      expansionUsed: false,
    };
  }

  const normalized = normalizeCatalogQuery(query);
  const expanded = expandCatalogSearchTerms(query, normalized.terms);
  const filters = enrichCatalogFiltersFromTerms(parseCatalogQueryFilters(query), normalized.terms);
  const { params: mergedParams } = mergeCatalogFilters(params, query, normalized.terms);
  const manufacturer = mergedParams.manufacturer?.trim() || normalized.manufacturer || filters.manufacturer;
  const inventoryLookup = expanded.intent === "inventory_lookup" || Boolean(filters.listAll);
  const maxResults = inventoryLookup
    ? Math.min(Math.max(mergedParams.max_results ?? 500, 1), 1000)
    : Math.min(Math.max(mergedParams.max_results ?? 12, 1), 100);

  const searchStages: string[] = [];
  let allHits: ScoredPriceBookHit[] = [];
  let totalScanned = 0;
  let expansionUsed = false;

  const { count } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  totalScanned = count ?? 0;

  // Stage 1: Core-term scan with expansion scoring
  searchStages.push("core_term_scan");
  const coreHits = await scanAndScoreProducts(
    supabase,
    organizationId,
    expanded,
    mergedParams,
    filters,
    manufacturer,
    { inventoryLookup },
  );
  allHits.push(...coreHits);

  // Stage 2: Category browse on core hint only (drops generic "cables" etc.)
  if (allHits.length === 0 && expanded.coreCategoryHint) {
    searchStages.push("category_browse");
    const browse = await browsePriceBookByFilters(
      supabase,
      organizationId,
      {
        ...mergedParams,
        query: expanded.coreCategoryHint,
        category: expanded.coreCategoryHint,
        max_results: maxResults,
      },
      { ...filters, categoryHint: expanded.coreCategoryHint },
    );
    if (browse.results.length > 0) {
      allHits = browse.results.map((hit) => ({
        ...hit,
        matchScore: 0.75,
        confidence: "high" as const,
        matchedTerms: expanded.coreTerms,
      }));
    }
  }

  // Stage 3: Partial single-token fallback (e.g. just "cat6")
  if (allHits.length === 0 && expanded.coreTerms.length > 0) {
    searchStages.push("partial_token_fallback");
    for (const token of expanded.coreTerms) {
      const singleExpanded = expandCatalogSearchTerms(token, [token]);
      const partialHits = await scanAndScoreProducts(
        supabase,
        organizationId,
        singleExpanded,
        mergedParams,
        filters,
        manufacturer,
        { inventoryLookup: true, minScore: 0.35 },
      );
      allHits.push(...partialHits);
    }
  }

  // Stage 4: Semantic search with expanded vocabulary
  if (allHits.length < maxResults) {
    searchStages.push("semantic_expansion");
    const familyMap = await loadFamilyMap(supabase);
    const semanticHits = await trySemanticSearch(
      supabase,
      organizationId,
      expanded.semanticText || expanded.coreCategoryHint || query,
      expanded,
      mergedParams,
      filters,
      manufacturer,
      familyMap,
    );
    if (semanticHits.length > 0) {
      expansionUsed = true;
      allHits.push(...semanticHits);
    }
  }

  // Stage 5: Generic-term expansion scan (user said "cables" — surface related infra)
  if (allHits.length === 0 && expanded.genericTerms.length > 0) {
    searchStages.push("generic_expansion");
    expansionUsed = true;
    const genericExpanded = expandCatalogSearchTerms(
      query,
      [...expanded.coreTerms, ...expanded.expansionTerms.slice(0, 8)],
    );
    const genericHits = await scanAndScoreProducts(
      supabase,
      organizationId,
      genericExpanded,
      mergedParams,
      filters,
      manufacturer,
      { inventoryLookup: true, minScore: 0.3 },
    );
    allHits.push(...genericHits);
  }

  return buildResponse(
    query,
    expanded,
    allHits,
    totalScanned,
    searchStages,
    maxResults,
    expansionUsed,
  );
}
