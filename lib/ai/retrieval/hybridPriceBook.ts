import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product, ProductFamily } from "@/types/database";
import { buildProductEmbeddingText } from "@/lib/ai/embeddings/embeddingText";
import { embedQuery } from "@/lib/ai/embeddings/embedQuery";
import { isHybridRetrievalEnabled } from "@/lib/ai/documentProcessingConfig";
import {
  normalizeCatalogQuery,
  passesCatalogMatchThreshold,
  scoreCatalogMatch,
} from "@/lib/ai/retrieval/catalogQueryNormalize";
import {
  browsePriceBookByFilters,
  mergeCatalogFilters,
  type PriceBookSearchHit,
  type PriceBookSearchParams,
} from "@/lib/ai/searchPriceBook";
import {
  type CatalogQueryFilters,
  catalogBrowseResultLimit,
  enrichCatalogFiltersFromTerms,
  isCatalogBrowseQuery,
  parseCatalogQueryFilters,
  passesSalesPriceFilter,
  productMatchesCategoryHint,
} from "@/lib/ai/retrieval/catalogQueryFilters";

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

function matchesFilters(
  hit: PriceBookSearchHit,
  params: PriceBookSearchParams,
  detectedManufacturer?: string,
  catalogFilters?: CatalogQueryFilters,
): boolean {
  if (
    !passesSalesPriceFilter(hit.sales_price, {
      maxSalesPrice: params.max_sales_price ?? catalogFilters?.maxSalesPrice,
      minSalesPrice: params.min_sales_price ?? catalogFilters?.minSalesPrice,
    })
  ) {
    return false;
  }

  const categoryHint = params.category?.trim() || catalogFilters?.categoryHint;
  if (categoryHint) {
    if (!productMatchesCategoryHint(hit, categoryHint)) return false;
  } else if (params.category?.trim()) {
    const cat = params.category.trim().toLowerCase();
    const type = (hit.product_type ?? "").toLowerCase();
    const category = (hit.category ?? "").toLowerCase();
    if (!type.includes(cat) && !category.includes(cat)) return false;
  }

  const mfr = params.manufacturer?.trim() || detectedManufacturer;
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

function rowToHit(
  row: SemanticProductRow | Product,
  familyName: string | null,
): PriceBookSearchHit {
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

function scoreProductRow(
  product: Product,
  familyName: string | null,
  terms: string[],
  manufacturer?: string,
): number {
  const text = buildProductEmbeddingText(product, familyName);
  return scoreCatalogMatch(text, terms, {
    manufacturer,
    brandField: product.product_brand ?? "",
  });
}

async function keywordScanProducts(
  supabase: SupabaseClient,
  organizationId: string,
  params: PriceBookSearchParams,
  normalized: ReturnType<typeof normalizeCatalogQuery>,
  maxResults: number,
  familyMap: Map<string, string>,
  catalogFilters?: CatalogQueryFilters,
  categoryBrowse?: boolean,
): Promise<{ hit: PriceBookSearchHit; score: number }[]> {
  const PAGE_SIZE = 1000;
  const MAX_SCAN = 5000;
  const hits: { hit: PriceBookSearchHit; score: number }[] = [];
  let page = 0;
  const mfr = params.manufacturer?.trim() || normalized.manufacturer;

  while (hits.length < maxResults * 3 && page * PAGE_SIZE < MAX_SCAN) {
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
      const score = scoreProductRow(product, familyName, normalized.terms, mfr);
      if (
        !passesCatalogMatchThreshold(score, normalized.terms.length, {
          categoryBrowse,
        })
      ) {
        continue;
      }

      const hit = rowToHit(product, familyName);
      if (!matchesFilters(hit, params, normalized.manufacturer, catalogFilters)) continue;
      hits.push({ hit, score });
    }

    if (data.length < PAGE_SIZE) break;
    page += 1;
  }

  return hits.sort((a, b) => b.score - a.score);
}

/**
 * Hybrid pricebook search: pgvector when embeddings exist, scored keyword match otherwise.
 */
export async function hybridSearchPriceBook(
  supabase: SupabaseClient,
  organizationId: string,
  params: PriceBookSearchParams,
  catalogFilters?: CatalogQueryFilters,
): Promise<{
  results: PriceBookSearchHit[];
  total_scanned: number;
  usedSemantic: boolean;
  total_matches?: number;
  truncated?: boolean;
}> {
  const query = params.query?.trim() ?? "";
  if (!query) {
    return { results: [], total_scanned: 0, usedSemantic: false };
  }

  const normalized = normalizeCatalogQuery(
    [params.query, params.use_case].filter(Boolean).join(" "),
  );
  const filters = enrichCatalogFiltersFromTerms(
    catalogFilters ?? parseCatalogQueryFilters(query),
    normalized.terms,
  );
  const { params: mergedParams } = mergeCatalogFilters(params, query, normalized.terms);
  const categoryBrowse = isCatalogBrowseQuery(filters, normalized.terms.length);
  const maxResults = categoryBrowse
    ? Math.max(mergedParams.max_results ?? 0, catalogBrowseResultLimit(filters))
    : Math.min(Math.max(mergedParams.max_results ?? 12, 1), 25);
  const mfr = mergedParams.manufacturer?.trim() || normalized.manufacturer;

  if (categoryBrowse || filters.manufacturer) {
    const browse = await browsePriceBookByFilters(
      supabase,
      organizationId,
      { ...mergedParams, max_results: maxResults },
      filters,
    );
    if (browse.match_count > 0 || browse.total_matches === 0) {
      return {
        results: browse.results,
        total_scanned: browse.total_scanned,
        total_matches: browse.total_matches,
        truncated: browse.truncated,
        usedSemantic: false,
      };
    }
  }

  const useSemantic = isHybridRetrievalEnabled();

  const familyMap = new Map<string, string>();
  const { data: families } = await supabase.from("product_families").select("id, name");
  for (const f of (families ?? []) as ProductFamily[]) {
    familyMap.set(f.id, f.name);
  }

  const { count } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  const total_scanned = count ?? 0;
  const embedText = normalized.searchText || query;
  const queryEmbedding = useSemantic ? await embedQuery(embedText) : null;

  if (queryEmbedding) {
    const { data: matches } = await supabase.rpc("match_products", {
      query_embedding: queryEmbedding,
      match_organization_id: organizationId,
      match_count: 40,
      match_threshold: parseFloat(process.env.SEMANTIC_MATCH_THRESHOLD ?? "0.2"),
    });

    const semanticRows = (matches ?? []) as SemanticProductRow[];
    if (semanticRows.length > 0) {
      const { data: familyRows } = await supabase
        .from("products")
        .select("id, product_family_id")
        .in("id", semanticRows.map((r) => r.id));

      const familyByProduct = new Map<string, string | null>();
      for (const fr of familyRows ?? []) {
        const fid = fr.product_family_id as string | null;
        familyByProduct.set(fr.id as string, fid ? familyMap.get(fid) ?? null : null);
      }

      const scored: { hit: PriceBookSearchHit; score: number }[] = [];

      for (const row of semanticRows) {
        const familyName = familyByProduct.get(row.id) ?? null;
        const hit = rowToHit(row, familyName);
        if (!matchesFilters(hit, mergedParams, normalized.manufacturer, filters)) continue;
        const text = buildProductEmbeddingText(row, hit.category);
        const kw = scoreCatalogMatch(text, normalized.terms, {
          manufacturer: mfr,
          brandField: row.product_brand ?? "",
        });
        const score = 0.65 * row.similarity + 0.35 * Math.max(kw, mfr ? 0.5 : 0);
        const kwOk = passesCatalogMatchThreshold(kw, normalized.terms.length, {
          categoryBrowse,
        });
        if (score > 0.15 && (kwOk || categoryBrowse)) scored.push({ hit, score });
      }

      if (scored.length > 0) {
        return {
          results: scored
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults)
            .map((s) => s.hit),
          total_scanned,
          usedSemantic: true,
        };
      }
    }
  }

  const hits = await keywordScanProducts(
    supabase,
    organizationId,
    mergedParams,
    normalized,
    maxResults,
    familyMap,
    filters,
    categoryBrowse,
  );

  return {
    results: hits.slice(0, maxResults).map((h) => h.hit),
    total_scanned,
    usedSemantic: false,
  };
}
