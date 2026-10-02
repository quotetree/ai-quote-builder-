import { roundToCents } from "./simpleMarkup.ts";

export type QuoteItemInput = {
  product_name: string;
  product_number?: string;
  description?: string;
  quantity: number;
  unit_price: number;
  /** Fraction from 0 to 1, not a percentage. */
  discount_percent?: number;
};

export type QuoteTotals = {
  items: (QuoteItemInput & { discount_percent: number; line_total: number; sort_order: number })[];
  subtotal: number;
};

/** Largest value a `numeric(12,2)` money column holds. */
export const MAX_MONEY = 9_999_999_999.99;

/**
 * Computes each item's line total and the quote subtotal.
 *
 * Each line is rounded to cents first, and the subtotal is the sum of the
 * rounded lines, so it always equals the sum of the stored line totals.
 */
export function computeQuoteTotals(items: QuoteItemInput[]): QuoteTotals {
  const computed = items.map((item, index) => {
    const discount = item.discount_percent ?? 0;
    return {
      ...item,
      discount_percent: discount,
      line_total: roundToCents(item.quantity * item.unit_price * (1 - discount)),
      sort_order: index,
    };
  });
  const subtotal = roundToCents(computed.reduce((sum, item) => sum + item.line_total, 0));
  return { items: computed, subtotal };
}

/**
 * Reports whether every line total and the subtotal fit their money columns.
 */
export function fitsMoneyColumns(totals: QuoteTotals): boolean {
  return totals.subtotal <= MAX_MONEY && totals.items.every((item) => item.line_total <= MAX_MONEY);
}
