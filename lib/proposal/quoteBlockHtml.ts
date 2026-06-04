import type { QuoteWithProfile } from "@/components/proposal-template/QuoteBlock";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const formatCurrency = (value: number | null | undefined) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value ?? 0);

const formatQuantity = (value: number | null | undefined) => {
  const n = value ?? 0;
  if (Number.isInteger(n)) return new Intl.NumberFormat("en-US").format(n);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
};

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "";
  if (Math.abs(value) < 0.0001) return "";
  const pct = value * 100;
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: pct % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  }).format(pct)}%`;
};

const safeNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const roundToCents = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

function calcItemMarkup(
  item: { product_name: string | null; line_total: number },
  markups: Array<{
    calculated_amount: number;
    base_total: number;
    base_applies_to?: string;
    base_excluded?: string[];
    audited?: unknown;
  }>
): number {
  if (!Array.isArray(markups) || markups.length === 0) return 0;
  const simpleMarkups = markups.filter(
    (m) => typeof m?.calculated_amount === "number" && safeNumber(m?.base_total) > 0 && !m?.audited
  );
  if (simpleMarkups.length === 0) return 0;
  return simpleMarkups.reduce((total, m) => {
    const excluded: string[] = Array.isArray(m.base_excluded) ? m.base_excluded : [];
    if (m.base_applies_to === "exclude_products" && item.product_name && excluded.includes(item.product_name)) {
      return total;
    }
    const share = (item.line_total / safeNumber(m.base_total)) * safeNumber(m.calculated_amount);
    return total + share;
  }, 0);
}

function getTaxInfo(quote: QuoteWithProfile["quote"]) {
  const fallbackRate = safeNumber(quote.tax_rate);
  const fallbackAmount = safeNumber(quote.tax_amount);
  const charges = Array.isArray(quote.charges) ? quote.charges : [];
  const taxCharges = charges.filter((c) =>
    (c?.name || "").toString().toLowerCase().includes("tax")
  );
  const aggregatedRate = taxCharges.reduce((s, c) => s + safeNumber(c?.rate), 0);
  const aggregatedAmount = taxCharges.reduce(
    (s, c) => s + safeNumber(c?.calculated_amount),
    0
  );
  return {
    rate: aggregatedRate > 0 ? aggregatedRate : fallbackRate,
    amount:
      aggregatedAmount > 0
        ? roundToCents(aggregatedAmount)
        : roundToCents(fallbackAmount),
  };
}

/** Server-side HTML for an embedded quote table (matches QuoteBlock layout). */
export function renderQuoteBlockHtml(
  data: QuoteWithProfile,
  imgMap: Record<string, string>
): string {
  const { quote, profile } = data;
  const items = quote.items ?? [];
  const { amount: taxAmount } = getTaxInfo(quote);
  const bakedMarkups = Array.isArray(quote.baked_markups) ? quote.baked_markups : [];
  const hasDiscount = (quote.discount_amount ?? 0) > 0;

  const lineRows = items.map((item) => {
    const discountPercent = safeNumber(item.discount_percent);
    const markupAmount = roundToCents(calcItemMarkup(item, bakedMarkups));
    const displayTotal = item.line_total + markupAmount;
    const displaySalesPrice =
      item.quantity > 0 ? displayTotal / item.quantity : item.unit_price;
    const displayListPrice =
      discountPercent > 0 && discountPercent < 1
        ? displaySalesPrice / (1 - discountPercent)
        : displaySalesPrice;

    return {
      name: item.product_name || item.product_number || "—",
      listPrice: displayListPrice,
      discount: discountPercent,
      salesPrice: displaySalesPrice,
      quantity: item.quantity,
      lineTotal: item.line_total,
      markupAmount,
    };
  });

  const logoUrl = profile?.company_logo_url;
  const logoSrc = logoUrl
    ? (logoUrl.startsWith("data:") ? logoUrl : (imgMap[logoUrl] ?? logoUrl))
    : null;

  const headerLeft = logoSrc
    ? `<img src="${logoSrc}" alt="" style="max-height:40px;max-width:160px;object-fit:contain;display:block;" />`
    : `<span style="font-size:18px;font-weight:bold;color:#1d4ed8;">${esc(profile?.company_name ?? "Company Name")}</span>`;

  const addressBlock = profile?.company_address
    ? `<span style="font-size:11px;color:#6b7280;white-space:pre-line;display:block;margin-top:4px;">${esc(profile.company_address)}</span>`
    : "";

  const rowsHtml =
    lineRows.length === 0
      ? `<tr><td colspan="6" style="padding:12px 8px;text-align:center;color:#9ca3af;font-style:italic;border:1px solid #e5e7eb;">No items</td></tr>`
      : lineRows
          .map(
            (row, i) =>
              `<tr style="background:${i % 2 === 0 ? "#ffffff" : "#f9fafb"};">` +
              `<td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;">${esc(row.name)}</td>` +
              `<td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;text-align:right;">${formatCurrency(row.listPrice)}</td>` +
              `<td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;text-align:center;">${formatPercent(row.discount)}</td>` +
              `<td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;text-align:right;">${formatCurrency(row.salesPrice)}</td>` +
              `<td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;text-align:center;">${formatQuantity(row.quantity)}</td>` +
              `<td style="padding:6px 8px;border:1px solid #e5e7eb;font-size:11px;text-align:right;font-weight:500;">${formatCurrency(row.lineTotal + row.markupAmount)}</td>` +
              `</tr>`
          )
          .join("");

  const discountRow = hasDiscount
    ? `<div style="display:flex;gap:24px;font-size:11px;color:#374151;">` +
      `<span>Discount${formatPercent(quote.discount_rate) ? ` (${formatPercent(quote.discount_rate)})` : ""}:</span>` +
      `<span style="min-width:80px;text-align:right;color:#dc2626;">-${formatCurrency(quote.discount_amount)}</span>` +
      `</div>`
    : "";

  return (
    `<div style="width:100%;background:#fff;color:#1f2937;font-family:Arial,Helvetica,sans-serif;font-size:13px;">` +
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e5e7eb;">` +
    `<div>${headerLeft}${addressBlock}</div>` +
    `<div style="text-align:right;font-size:11px;color:#4b5563;flex-shrink:0;margin-left:16px;">` +
    `<span style="font-weight:500;">Quote #:</span> ${esc(quote.quote_number)}` +
    `</div></div>` +
    `<table style="width:100%;border-collapse:collapse;font-size:11px;">` +
    `<thead><tr style="background:#374151;color:#fff;">` +
    `<th style="padding:6px 8px;text-align:left;font-weight:600;">Product</th>` +
    `<th style="padding:6px 8px;text-align:right;font-weight:600;">List Price</th>` +
    `<th style="padding:6px 8px;text-align:center;font-weight:600;">Discount</th>` +
    `<th style="padding:6px 8px;text-align:right;font-weight:600;">Sales Price</th>` +
    `<th style="padding:6px 8px;text-align:center;font-weight:600;">Qty</th>` +
    `<th style="padding:6px 8px;text-align:right;font-weight:600;">Total</th>` +
    `</tr></thead><tbody>${rowsHtml}</tbody></table>` +
    `<div style="margin-top:12px;display:flex;flex-direction:column;align-items:flex-end;gap:2px;">` +
    `<div style="display:flex;gap:24px;font-size:11px;color:#374151;"><span>Subtotal:</span>` +
    `<span style="min-width:80px;text-align:right;">${formatCurrency(quote.subtotal)}</span></div>` +
    discountRow +
    `<div style="display:flex;gap:24px;font-size:11px;color:#374151;"><span>Tax:</span>` +
    `<span style="min-width:80px;text-align:right;">${formatCurrency(taxAmount)}</span></div>` +
    `<div style="display:flex;gap:24px;font-size:13px;font-weight:bold;color:#111827;margin-top:4px;padding-top:4px;border-top:1px solid #d1d5db;">` +
    `<span>Total:</span><span style="min-width:80px;text-align:right;">${formatCurrency(quote.total_price)}</span></div>` +
    `</div></div>`
  );
}
