import type { Product } from "@/types/database";

/**
 * Text blob used for embedding pricebook items (and hybrid keyword search).
 */
export function buildProductEmbeddingText(
  product: Pick<
    Product,
    | "product_name"
    | "product_number"
    | "product_brand"
    | "product_type"
    | "product_tags"
    | "description"
  >,
  familyName?: string | null,
  extras?: {
    notes?: string | null;
    laborAssumptions?: string | null;
    compatibleAccessories?: string | null;
    commonUseCases?: string | null;
  },
): string {
  const parts = [
    product.product_name,
    product.product_number ? `SKU ${product.product_number}` : null,
    product.product_brand ? `Manufacturer ${product.product_brand}` : null,
    product.product_type ? `Type ${product.product_type}` : null,
    familyName ? `Category ${familyName}` : null,
    product.description,
    product.product_tags?.length ? `Tags: ${product.product_tags.join(", ")}` : null,
    extras?.notes,
    extras?.laborAssumptions ? `Labor: ${extras.laborAssumptions}` : null,
    extras?.compatibleAccessories ? `Compatible: ${extras.compatibleAccessories}` : null,
    extras?.commonUseCases ? `Use cases: ${extras.commonUseCases}` : null,
  ].filter(Boolean);

  return parts.join("\n").slice(0, 12_000);
}

export function buildMemoryEmbeddingText(
  title: string | null | undefined,
  content: string,
  tags?: string[] | null,
): string {
  const parts = [title, content, tags?.length ? `Tags: ${tags.join(", ")}` : null].filter(Boolean);
  return parts.join("\n").slice(0, 8_000);
}
