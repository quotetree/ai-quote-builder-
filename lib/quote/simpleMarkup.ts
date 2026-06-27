export interface SimpleMarkupLineItem {
  name: string;
  amount: number;
}

export type MarkupAppliesTo = "all" | "exclude_products";
export type MarkupDistribution = "proportional" | "even" | "single";

export interface SpreadsheetSimpleMarkup {
  id: string;
  name: string;
  mode: "percent" | "amount";
  value: number;
  base_applies_to: MarkupAppliesTo;
  base_excluded: string[];
  add_applies_to?: MarkupAppliesTo;
  add_excluded?: string[];
  distribution?: MarkupDistribution;
  single_item?: string;
  per_item_deltas?: Record<string, number>;
  calculated_amount: number;
  base_total: number;
}

export const roundToCents = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function getItemsForMarkupSelector(
  allItems: SimpleMarkupLineItem[],
  appliesTo: MarkupAppliesTo,
  excluded: string[],
): SimpleMarkupLineItem[] {
  if (appliesTo === "all") return allItems;
  return allItems.filter((i) => !excluded.includes(i.name));
}

/** Distributes a markup amount across target line items. */
export function computeMarkupPerItemDeltas(
  markupAmount: number,
  targetItems: SimpleMarkupLineItem[],
  distribution: MarkupDistribution,
  singleItem?: string,
): Record<string, number> {
  if (markupAmount <= 0 || targetItems.length === 0) return {};

  const deltas: Record<string, number> = {};

  if (distribution === "single") {
    const target =
      singleItem && targetItems.some((i) => i.name === singleItem)
        ? singleItem
        : targetItems[0]?.name;
    if (target) deltas[target] = roundToCents(markupAmount);
    return deltas;
  }

  if (distribution === "even") {
    let assigned = 0;
    targetItems.forEach((item, index) => {
      const amt =
        index === targetItems.length - 1
          ? roundToCents(markupAmount - assigned)
          : roundToCents(markupAmount / targetItems.length);
      deltas[item.name] = amt;
      assigned += amt;
    });
    return deltas;
  }

  const targetTotal = targetItems.reduce((sum, item) => sum + item.amount, 0);
  if (targetTotal <= 0) return {};

  let assigned = 0;
  targetItems.forEach((item, index) => {
    const amt =
      index === targetItems.length - 1
        ? roundToCents(markupAmount - assigned)
        : roundToCents((item.amount / targetTotal) * markupAmount);
    deltas[item.name] = amt;
    assigned += amt;
  });

  return deltas;
}

/** Customer-facing line total: base line_total plus any hidden SimpleMarkup share. */
export function calcCustomerFacingLineTotal(
  item: { product_name: string | null; line_total: number },
  markups: any[],
): number {
  return roundToCents(item.line_total + calcSimpleItemMarkup(item, markups));
}

/** Customer-facing subtotal: sum of markup-inclusive line totals (matches visible table rows). */
export function calcCustomerFacingSubtotal(
  items: Array<{ product_name: string | null; line_total: number }>,
  markups: any[],
): number {
  return roundToCents(
    items.reduce((sum, item) => sum + calcCustomerFacingLineTotal(item, markups), 0),
  );
}

/** Allocates spreadsheet SimpleMarkup amounts to a quote line item. */
export function calcSimpleItemMarkup(
  item: { product_name: string | null; line_total: number },
  markups: any[],
): number {
  if (!Array.isArray(markups) || markups.length === 0) return 0;

  const simpleMarkups = markups.filter(
    (m) => typeof m?.calculated_amount === "number" && safeNumber(m?.base_total) > 0 && !m?.audited,
  );
  if (simpleMarkups.length === 0) return 0;

  return simpleMarkups.reduce((total, m) => {
    const name = item.product_name ?? "";
    if (!name) return total;

    if (m.per_item_deltas && typeof m.per_item_deltas === "object") {
      const delta = m.per_item_deltas[name];
      return typeof delta === "number" ? total + delta : total;
    }

    // Legacy fallback: proportional share across all non-base-excluded items
    const excluded: string[] = Array.isArray(m.base_excluded) ? m.base_excluded : [];
    if (m.base_applies_to === "exclude_products" && excluded.includes(name)) {
      return total;
    }
    const share = (item.line_total / safeNumber(m.base_total)) * safeNumber(m.calculated_amount);
    return total + share;
  }, 0);
}

function safeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
