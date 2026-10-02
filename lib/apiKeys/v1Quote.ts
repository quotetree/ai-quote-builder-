// Explicit projection: a new column on quotes is never published here by accident
export const V1_QUOTE_COLUMNS =
  "id, quote_number, quote_name, status, subtotal, tax_amount, total_price, expiration_date, created_at, updated_at";

export const V1_QUOTE_ITEM_COLUMNS =
  "id, product_name, product_number, description, quantity, unit_price, discount_percent, line_total, sort_order";

export type V1QuoteWithItems = Record<string, unknown> & { items: Record<string, unknown>[] };

const QUOTE_KEYS = V1_QUOTE_COLUMNS.split(", ");
const ITEM_KEYS = V1_QUOTE_ITEM_COLUMNS.split(", ");

function pick(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in row) out[key] = row[key];
  }
  return out;
}

/**
 * Reduces a full quote row and its item rows to the columns the v1 API publishes.
 */
export function projectV1Quote(
  quote: Record<string, unknown>,
  items: Record<string, unknown>[]
): V1QuoteWithItems {
  return { ...pick(quote, QUOTE_KEYS), items: items.map((item) => pick(item, ITEM_KEYS)) };
}
