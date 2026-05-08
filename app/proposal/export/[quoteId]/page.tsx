import { notFound } from "next/navigation";
import { getServiceClient } from "@/lib/supabase/service";
import { TemplatePage } from "@/components/proposal-template/proposalTemplateTypes";
import ProposalExportView from "@/components/proposal-template/ProposalExportView";
import { verifyExportToken } from "@/lib/proposal/exportToken";
import type { QuoteWithProfile } from "@/components/proposal-template/QuoteBlock";

interface Props {
  params: Promise<{ quoteId: string }>;
  searchParams: Promise<{ token?: string }>;
}

/**
 * Pre-fetches every unique background-image URL referenced by the proposal
 * pages and converts them to base64 data URIs.
 *
 * This runs server-side so PDFShift receives a fully self-contained HTML
 * document with no external image requests — eliminating the race condition
 * where the `delay` expires before Supabase CDN images finish loading.
 */
async function prefetchBackgroundImages(
  pages: TemplatePage[]
): Promise<Record<string, string>> {
  const urls = new Set<string>();
  for (const page of pages) {
    if (page.backgroundImage) urls.add(page.backgroundImage);
  }

  const result: Record<string, string> = {};
  await Promise.all(
    Array.from(urls).map(async (url) => {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          // Avoid any cached stale content
          cache: "no-store",
        });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const mime = res.headers.get("content-type") ?? "image/png";
          result[url] = `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
          console.log(
            `[export] prefetch OK: ${url.slice(0, 80)}…  ` +
            `size=${Math.round(buf.byteLength / 1024)}KB`
          );
        } else {
          console.warn(`[export] prefetch HTTP ${res.status}: ${url.slice(0, 80)}`);
        }
      } catch (err) {
        console.warn(`[export] prefetch failed: ${url.slice(0, 80)} — ${err instanceof Error ? err.message : err}`);
      }
    })
  );

  return result;
}

/**
 * Proposal export page — fetched by PDFShift to generate a clean PDF.
 *
 * Security model:
 *   1. Middleware allows unauthenticated access only when ?token= is present.
 *   2. This page verifies the token is valid, unexpired, and bound to this quoteId
 *      BEFORE making any database call.
 *   3. Only after successful verification does it use the service role client
 *      to fetch proposal data (bypassing RLS, since PDFShift has no auth cookie).
 *   4. Missing, expired, or tampered tokens → 404 (no information leakage).
 */
export default async function ProposalExportPage({ params, searchParams }: Props) {
  const { quoteId } = await params;
  const { token } = await searchParams;

  // ── Token validation (before any DB access) ───────────────────────────────
  if (!token || !verifyExportToken(quoteId, token)) {
    notFound();
  }

  // ── Fetch proposal data using service role (bypasses RLS) ─────────────────
  const admin = getServiceClient();
  const { data, error } = await admin
    .from("quote_proposals")
    .select("pages")
    .eq("quote_id", quoteId)
    .single();

  if (error || !data) {
    notFound();
  }

  const pages: TemplatePage[] = Array.isArray(data.pages) ? data.pages : [];

  // Debug: log what the DB returned so we can spot empty-pages issues
  console.log(
    `[export] quoteId=${quoteId}  pages=${pages.length}  ` +
    `bgImages=${pages.filter((p) => !!p.backgroundImage).length}  ` +
    `elements=${pages.reduce((n, p) => n + p.elements.length, 0)}`
  );

  if (pages.length === 0) {
    console.warn("[export] pages array is empty — PDF will be blank");
  }

  // ── Pre-fetch background images as base64 so PDFShift gets self-contained HTML ──
  const backgroundImageDataUrls = await prefetchBackgroundImages(pages);
  console.log(
    `[export] prefetched ${Object.keys(backgroundImageDataUrls).length} / ` +
    `${pages.filter((p) => !!p.backgroundImage).length} background images`
  );

  // ── Pre-fetch data for any embedded quote elements ─────────────────────────
  // Collect unique quoteIds from all quote-type elements across all pages.
  const embeddedQuoteIds = new Set<string>();
  for (const page of pages) {
    for (const el of page.elements) {
      if (el.type === "quote" && el.content) {
        try {
          const parsed = JSON.parse(el.content);
          if (parsed.quoteId) embeddedQuoteIds.add(parsed.quoteId);
        } catch {
          // malformed content — skip
        }
      }
    }
  }

  const quoteDataMap: Record<string, QuoteWithProfile> = {};

  if (embeddedQuoteIds.size > 0) {
    await Promise.all(
      Array.from(embeddedQuoteIds).map(async (qId) => {
        try {
          const { data: quoteData } = await admin
            .from("quotes")
            .select("*, items:quote_items(*)")
            .eq("id", qId)
            .single();

          if (!quoteData) return;

          const { data: org } = await admin
            .from("organizations")
            .select("owner_id")
            .eq("id", quoteData.organization_id)
            .single();

          let profile = null;
          if (org?.owner_id) {
            const { data: p } = await admin
              .from("profiles")
              .select("company_name, company_address, company_logo_url")
              .eq("id", org.owner_id)
              .single();
            profile = p ?? null;
          }

          quoteDataMap[qId] = { quote: quoteData, profile };
        } catch {
          // non-fatal — QuoteBlock will show an error state for this element
        }
      })
    );
  }

  return (
    <>
      <meta name="robots" content="noindex, nofollow" />
      <ProposalExportView
        pages={pages}
        quoteDataMap={Object.keys(quoteDataMap).length > 0 ? quoteDataMap : undefined}
        backgroundImageDataUrls={backgroundImageDataUrls}
      />
    </>
  );
}
