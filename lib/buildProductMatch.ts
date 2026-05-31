import type { SupabaseClient } from "@supabase/supabase-js";
import { searchProductsForBuildItem } from "@/lib/filterProducts";
import type { PriceBookSearchHit } from "@/lib/ai/searchPriceBook";
import type { Product, ProductFamily } from "@/types/database";

const PAGE_SIZE = 1000;
const MAX_SCAN = 5000;

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

/** Paginated org catalog — same ordering as spreadsheet useProducts fetch. */
export async function fetchOrganizationProducts(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ products: Product[]; familyMap: Map<string, string> }> {
  const familyMap = await loadFamilyNames(supabase);
  const products: Product[] = [];
  let page = 0;

  while (products.length < MAX_SCAN) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from("products")
      .select(
        "id, product_name, product_number, product_brand, product_type, product_family_id, product_tags, description, list_price, sales_price, cost_price, unit",
      )
      .eq("organization_id", organizationId)
      .order("product_name", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data?.length) break;
    products.push(...(data as Product[]));
    if (data.length < PAGE_SIZE) break;
    page += 1;
  }

  return { products, familyMap };
}

/**
 * Match products using the same filterProducts logic and catalog order as SpreadsheetEditor.
 */
export function matchProductsForBuildItem(
  products: Product[],
  familyMap: Map<string, string>,
  searchQuery: string,
  requestedLabel: string,
  maxResults = 3,
): PriceBookSearchHit[] {
  const hits = searchProductsForBuildItem(
    products,
    searchQuery,
    requestedLabel,
    maxResults,
  );

  return hits.map((p) => {
    const familyName = p.product_family_id
      ? familyMap.get(p.product_family_id) ?? null
      : null;
    return productToHit(p, familyName);
  });
}
