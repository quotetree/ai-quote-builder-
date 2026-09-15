/**
 * Free-plan unique quote export entitlements.
 * Metering is UNIQUE quote_ids per Pacific calendar month — not PDF download count.
 * Consumption is reserved atomically via reserve_quote_export_credit (DB RPC).
 */

export const FREE_UNIQUE_QUOTE_EXPORTS_PER_MONTH = 5;
export const USAGE_TIMEZONE = "America/Los_Angeles";

export const QUOTE_EXPORT_LIMIT_CODE = "QUOTE_EXPORT_LIMIT_REACHED";

export type QuoteExportReserveResult = {
  allowed: boolean;
  consumed?: boolean;
  unlimited?: boolean;
  used?: number | null;
  limit?: number | null;
  period_key?: string;
  period_start?: string;
  period_end?: string;
  organization_id?: string;
  quote_id?: string;
  code?: string;
  message?: string;
};

export type QuoteExportUsage = {
  unlimited: boolean;
  used: number;
  limit: number | null;
  period_key: string;
  period_start: string;
  period_end: string;
  organization_id?: string;
  plan_type?: string;
  status?: string;
  code?: string;
};

/** Format period_end (ISO) as e.g. "Apr 1, 2026" in Pacific. */
export function formatQuoteExportResetDate(periodEndIso: string | null | undefined): string | null {
  if (!periodEndIso) return null;
  const d = new Date(periodEndIso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: USAGE_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/** e.g. "2 of 5 free quotes used · Resets Apr 1, 2026" */
export function formatFreeQuoteUsageLabel(usage: {
  used: number;
  limit: number;
  period_end?: string | null;
}): string {
  const base = `${usage.used} of ${usage.limit} free quotes used`;
  const reset = formatQuoteExportResetDate(usage.period_end ?? null);
  return reset ? `${base} · Resets ${reset}` : base;
}
