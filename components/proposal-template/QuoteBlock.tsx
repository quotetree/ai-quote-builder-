"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuoteItem {
  id: string;
  product_name: string | null;
  product_number: string | null;
  quantity: number;
  unit_price: number;
  discount_percent: number | null;
  line_total: number;
}

interface QuoteData {
  id: string;
  quote_number: string;
  quote_name: string;
  subtotal: number | null;
  tax_rate: number | null;
  tax_amount: number | null;
  discount_rate: number | null;
  discount_amount: number | null;
  total_price: number | null;
  charges: ChargeConfig[] | null;
  organization_id: string;
  items: QuoteItem[];
}

interface ChargeConfig {
  name: string;
  rate: number;
  calculated_amount: number;
}

interface ProfileData {
  company_name: string | null;
  company_address: string | null;
  company_logo_url: string | null;
}

export interface QuoteWithProfile {
  quote: QuoteData;
  profile: ProfileData | null;
}

// ─── Formatting helpers (matches /api/quotes/pdf logic exactly) ───────────────

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

function getTaxInfo(quote: QuoteData) {
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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface QuoteBlockProps {
  quoteId: string;
  /** Pre-fetched data (used by the export page to avoid client-side RLS issues) */
  preloadedData?: QuoteWithProfile;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function QuoteBlock({ quoteId, preloadedData }: QuoteBlockProps) {
  const [data, setData] = useState<QuoteWithProfile | null>(preloadedData ?? null);
  const [loading, setLoading] = useState(!preloadedData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preloadedData) {
      setData(preloadedData);
      setLoading(false);
      return;
    }
    if (!quoteId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const supabase = createClient();

        const { data: quote, error: qErr } = await supabase
          .from("quotes")
          .select("*, items:quote_items(*)")
          .eq("id", quoteId)
          .single();

        if (qErr || !quote) throw new Error(qErr?.message || "Quote not found");

        // Fetch org owner's profile for branding
        const { data: org } = await supabase
          .from("organizations")
          .select("owner_id")
          .eq("id", quote.organization_id)
          .single();

        let profile: ProfileData | null = null;
        if (org?.owner_id) {
          const { data: p } = await supabase
            .from("profiles")
            .select("company_name, company_address, company_logo_url")
            .eq("id", org.owner_id)
            .single();
          profile = p ?? null;
        }

        if (!cancelled) {
          setData({ quote, profile });
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load quote");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [quoteId, preloadedData]);

  if (loading) {
    return (
      <div className="w-full py-8 flex items-center justify-center text-sm text-gray-400">
        Loading quote…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full py-6 flex items-center justify-center text-sm text-red-400">
        {error ?? "Could not load quote."}
      </div>
    );
  }

  const { quote, profile } = data;
  const items: QuoteItem[] = quote.items ?? [];
  const { amount: taxAmount } = getTaxInfo(quote);

  // Build line rows using the same markup-hiding logic as the PDF
  const lineRows = items.map((item) => {
    const salesPrice =
      item.quantity > 0 ? item.line_total / item.quantity : item.unit_price;
    const discountPercent = safeNumber(item.discount_percent);
    const displayListPrice =
      discountPercent > 0 && discountPercent < 1
        ? salesPrice / (1 - discountPercent)
        : salesPrice;

    return {
      name: item.product_name || item.product_number || "—",
      listPrice: displayListPrice,
      discount: discountPercent,
      salesPrice,
      quantity: item.quantity,
      lineTotal: item.line_total,
    };
  });

  const hasDiscount = (quote.discount_amount ?? 0) > 0;

  return (
    <div
      className="w-full bg-white text-gray-800 font-sans text-sm"
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      {/* ── Header: logo / company name + quote number ── */}
      <div className="flex items-start justify-between mb-4 pb-3 border-b border-gray-200">
        <div className="flex flex-col gap-1">
          {profile?.company_logo_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={profile.company_logo_url}
              alt="Company logo"
              crossOrigin="anonymous"
              className="max-h-10 max-w-[160px] object-contain object-left"
            />
          ) : (
            <span className="text-lg font-bold text-blue-700">
              {profile?.company_name ?? "Company Name"}
            </span>
          )}
          {profile?.company_address && (
            <span className="text-xs text-gray-500 whitespace-pre-line">
              {profile.company_address}
            </span>
          )}
        </div>
        <div className="text-right text-xs text-gray-600 flex-shrink-0 ml-4">
          <span className="font-medium">Quote #:</span> {quote.quote_number}
        </div>
      </div>

      {/* ── Line items table ── */}
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-gray-700 text-white">
            <th className="px-2 py-1.5 text-left font-semibold">Product</th>
            <th className="px-2 py-1.5 text-right font-semibold">List Price</th>
            <th className="px-2 py-1.5 text-center font-semibold">Discount</th>
            <th className="px-2 py-1.5 text-right font-semibold">Sales Price</th>
            <th className="px-2 py-1.5 text-center font-semibold">Qty</th>
            <th className="px-2 py-1.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {lineRows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-2 py-3 text-center text-gray-400 italic">
                No items
              </td>
            </tr>
          ) : (
            lineRows.map((row, i) => (
              <tr
                key={i}
                className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}
              >
                <td className="px-2 py-1.5 border border-gray-200">{row.name}</td>
                <td className="px-2 py-1.5 border border-gray-200 text-right">
                  {formatCurrency(row.listPrice)}
                </td>
                <td className="px-2 py-1.5 border border-gray-200 text-center">
                  {formatPercent(row.discount)}
                </td>
                <td className="px-2 py-1.5 border border-gray-200 text-right">
                  {formatCurrency(row.salesPrice)}
                </td>
                <td className="px-2 py-1.5 border border-gray-200 text-center">
                  {formatQuantity(row.quantity)}
                </td>
                <td className="px-2 py-1.5 border border-gray-200 text-right font-medium">
                  {formatCurrency(row.lineTotal)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* ── Totals footer ── */}
      <div className="mt-3 flex flex-col items-end gap-0.5">
        <div className="flex gap-6 text-xs text-gray-700">
          <span>Subtotal:</span>
          <span className="min-w-[80px] text-right">{formatCurrency(quote.subtotal)}</span>
        </div>

        {hasDiscount && (
          <div className="flex gap-6 text-xs text-gray-700">
            <span>
              Discount{formatPercent(quote.discount_rate) ? ` (${formatPercent(quote.discount_rate)})` : ""}:
            </span>
            <span className="min-w-[80px] text-right text-red-600">
              -{formatCurrency(quote.discount_amount)}
            </span>
          </div>
        )}

        <div className="flex gap-6 text-xs text-gray-700">
          <span>Tax:</span>
          <span className="min-w-[80px] text-right">{formatCurrency(taxAmount)}</span>
        </div>

        <div className="flex gap-6 text-sm font-bold text-gray-900 mt-1 pt-1 border-t border-gray-300">
          <span>Total:</span>
          <span className="min-w-[80px] text-right">{formatCurrency(quote.total_price)}</span>
        </div>
      </div>
    </div>
  );
}
