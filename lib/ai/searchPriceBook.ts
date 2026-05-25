import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product, ProductFamily } from "@/types/database";

export interface PriceBookSearchParams {
  query: string;
  category?: string;
  manufacturer?: string;
  tags?: string[];
  /** Extra terms often describing install context / use case (searched in description + tags). */
  use_case?: string;
  max_results?: number;
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
): boolean {
  if (params.category?.trim()) {
    const cat = params.category.trim().toLowerCase();
    const type = (product.product_type ?? "").toLowerCase();
    const family = (familyName ?? "").toLowerCase();
    if (!type.includes(cat) && !family.includes(cat)) return false;
  }

  if (params.manufacturer?.trim()) {
    const mfr = params.manufacturer.trim().toLowerCase();
    const brand = (product.product_brand ?? "").toLowerCase();
    if (!brand.includes(mfr)) return false;
  }

  if (params.tags?.length) {
    const tagBlob = (product.product_tags ?? []).join(" ").toLowerCase();
    for (const tag of params.tags) {
      if (tag.trim() && !tagBlob.includes(tag.trim().toLowerCase())) return false;
    }
  }

  return true;
}

export async function searchPriceBook(
  supabase: SupabaseClient,
  params: PriceBookSearchParams,
): Promise<PriceBookSearchResponse> {
  const query = params.query?.trim() ?? "";
  if (!query) {
    return { query: "", total_scanned: 0, match_count: 0, results: [] };
  }

  const maxResults = Math.min(Math.max(params.max_results ?? DEFAULT_MAX_RESULTS, 1), 25);
  const searchTerms = normalizeTerms(query, params.use_case);
  const [products, familyMap] = await Promise.all([
    fetchAllProducts(supabase),
    loadFamilyNames(supabase),
  ]);

  const hits: PriceBookSearchHit[] = [];

  for (const product of products) {
    const familyName = product.product_family_id
      ? familyMap.get(product.product_family_id) ?? null
      : null;

    if (!matchesFilters(product, familyName, params)) continue;

    const text = productSearchableText(product, familyName, []);
    if (!searchTerms.every((term) => text.includes(term))) continue;

    hits.push({
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

    if (hits.length >= maxResults) break;
  }

  return {
    query,
    total_scanned: products.length,
    match_count: hits.length,
    results: hits,
  };
}

export function formatPriceBookResultsForPrompt(search: PriceBookSearchResponse): string {
  if (search.match_count === 0) {
    return `No price book products matched "${search.query}" (searched ${search.total_scanned} items). Try broader keywords or a different category/brand.`;
  }

  const lines = [
    `Price book search: "${search.query}" — ${search.match_count} match(es) (read-only catalog; prices are reference).`,
    "",
  ];

  for (const p of search.results) {
    const parts = [
      `**${p.product_name}**`,
      p.product_number ? `SKU: ${p.product_number}` : null,
      p.product_brand ? `Manufacturer: ${p.product_brand}` : null,
      p.category ? `Category: ${p.category}` : null,
      p.product_tags?.length ? `Tags: ${p.product_tags.join(", ")}` : null,
    ].filter(Boolean);

    lines.push(`- ${parts.join(" | ")}`);
    lines.push(
      `  Unit: ${p.unit} | List: ${formatMoney(p.list_price)} | Sales: ${formatMoney(p.sales_price)}${
        p.cost_price != null ? ` | Cost: ${formatMoney(p.cost_price)}` : ""
      }`,
    );
    if (p.description?.trim()) {
      lines.push(`  Description: ${p.description.trim().slice(0, 400)}`);
    }
    lines.push("");
  }

  lines.push(
    "To add any item to the active estimate, tell the user to add it in Drive via the spreadsheet product picker (not through this chat).",
  );

  return lines.join("\n").trim();
}
