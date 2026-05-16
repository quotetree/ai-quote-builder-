/**
 * GET /api/firma/download-signed?quoteId=...
 *
 * Server-side proxy that fetches the Firma-signed PDF for a completed
 * signing request and streams it back to the browser as a downloadable
 * attachment. Bypasses browser CORS restrictions on Firma's CDN URLs.
 *
 * If signed_pdf_url is missing from the DB (e.g. webhook fired before
 * Firma finished generating the final bundle), this route calls Firma
 * directly to get the URL, persists it, and then serves the PDF.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getOrCreateFirmaWorkspace } from "@/lib/firma";

const FIRMA_API_BASE = "https://api.firma.dev/functions/v1/signing-request-api";

/** Searches top-level and common wrapper keys for a scalar string field. */
function extractField(raw: Record<string, unknown>, key: string): string | null {
  if (typeof raw[key] === "string" && raw[key] !== "") return raw[key] as string;
  for (const w of ["data", "signing_request", "result", "record", "signingRequest"]) {
    const nested = raw[w];
    if (nested && typeof nested === "object") {
      const val = (nested as Record<string, unknown>)[key];
      if (typeof val === "string" && val !== "") return val;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const quoteId = req.nextUrl.searchParams.get("quoteId");
  // view=1 → Content-Disposition: inline (browser renders in-tab / iframe)
  // default  → Content-Disposition: attachment (browser downloads the file)
  const viewMode = req.nextUrl.searchParams.get("view") === "1";

  if (!quoteId) {
    return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Verify the user is authenticated
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Step 1: resolve quote_id → proposal_id via quote_proposals
  const { data: proposal, error: proposalErr } = await supabase
    .from("quote_proposals")
    .select("id, organization_id")
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (proposalErr) {
    console.error("[download-signed] proposal lookup error:", proposalErr.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!proposal) {
    return NextResponse.json({ error: "No proposal found for this quote" }, { status: 404 });
  }

  // Step 2: look up the signature row via service client (bypasses RLS)
  const db = getServiceClient();
  const { data: sigRow, error: sigErr } = await db
    .from("proposal_signatures")
    .select("id, signed_pdf_url, audit_trail_url, status, firma_signing_request_id, organization_id")
    .eq("proposal_id", proposal.id)
    .maybeSingle();

  if (sigErr) {
    console.error("[download-signed] signature lookup error:", sigErr.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!sigRow) {
    return NextResponse.json({ error: "No signing record found for this proposal" }, { status: 404 });
  }

  // Step 3: always call Firma to get a fresh download URL.
  // Firma's download URLs are time-limited pre-signed URLs that expire, so we
  // never rely on a cached URL for the actual binary fetch.
  let signedPdfUrl: string | null = null;

  if (sigRow.firma_signing_request_id) {
    console.log(`[download-signed] signed_pdf_url missing — fetching from Firma | sigId: ${sigRow.id}`);

    const firmaRequestId = sigRow.firma_signing_request_id as string;
    const orgId = (sigRow.organization_id ?? proposal.organization_id) as string;

    let workspaceKey: string | null = null;
    try {
      workspaceKey = await getOrCreateFirmaWorkspace(orgId);
    } catch (e) {
      console.warn("[download-signed] workspace key lookup failed:", e);
    }

    const tryFirmaFetch = async (apiKey: string) =>
      fetch(`${FIRMA_API_BASE}/signing-requests/${firmaRequestId}`, {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      });

    let firmaRes: Response | null = null;
    if (workspaceKey) {
      firmaRes = await tryFirmaFetch(workspaceKey).catch(() => null);
      if (firmaRes && (firmaRes.status === 401 || firmaRes.status === 403) && process.env.FIRMA_API_KEY) {
        firmaRes = await tryFirmaFetch(process.env.FIRMA_API_KEY.trim()).catch(() => null);
      }
    } else if (process.env.FIRMA_API_KEY) {
      firmaRes = await tryFirmaFetch(process.env.FIRMA_API_KEY.trim()).catch(() => null);
    }

    if (firmaRes?.ok) {
      const firmaText = await firmaRes.text().catch(() => "");
      console.log(`[download-signed] Firma raw response (first 800 chars): ${firmaText.slice(0, 800)}`);

      let firmaRaw: Record<string, unknown> = {};
      try { firmaRaw = JSON.parse(firmaText) as Record<string, unknown>; } catch { /* no-op */ }

      // Try all known Firma URL field names, preferring the final certified bundle
      signedPdfUrl =
        extractField(firmaRaw, "final_document_download_url") ??
        extractField(firmaRaw, "document_only_download_url") ??
        extractField(firmaRaw, "document_url") ??
        extractField(firmaRaw, "signed_pdf_url") ??
        extractField(firmaRaw, "signed_document_url") ??
        extractField(firmaRaw, "download_url") ??
        extractField(firmaRaw, "pdf_url") ??
        extractField(firmaRaw, "file_url") ??
        null;

      const auditUrl =
        extractField(firmaRaw, "certificate_only_download_url") ??
        extractField(firmaRaw, "audit_trail_url") ??
        null;

      if (signedPdfUrl) {
        // Persist it so future calls (and the UI) can use it without re-fetching Firma
        const updatePayload: Record<string, unknown> = {
          signed_pdf_url: signedPdfUrl,
          updated_at: new Date().toISOString(),
        };
        if (auditUrl && !sigRow.audit_trail_url) updatePayload.audit_trail_url = auditUrl;
        if (sigRow.status !== "completed") updatePayload.status = "completed";

        const { error: updateErr } = await db
          .from("proposal_signatures")
          .update(updatePayload)
          .eq("id", sigRow.id);
        if (updateErr) {
          console.warn("[download-signed] failed to persist signed_pdf_url:", updateErr.message);
        } else {
          console.log(`[download-signed] ✅ persisted signed_pdf_url for sig ${sigRow.id}`);
        }
      } else {
        // Log all top-level keys so we can see what Firma actually returned
        const keys = Object.keys(firmaRaw).join(", ");
        console.warn(`[download-signed] Firma response had no recognised PDF URL field. Top-level keys: [${keys}]`);
      }
    } else {
      console.warn(`[download-signed] Firma fetch failed or returned non-OK: ${firmaRes?.status ?? "no response"}`);
    }
  }

  // Last resort: fall back to the cached DB URL (may be expired, but worth trying)
  if (!signedPdfUrl && sigRow.signed_pdf_url) {
    console.warn("[download-signed] falling back to cached signed_pdf_url from DB");
    signedPdfUrl = sigRow.signed_pdf_url as string;
  }

  if (!signedPdfUrl) {
    return NextResponse.json(
      { error: "Signed PDF not yet available. The document may still be processing — please try again in a moment." },
      { status: 404 }
    );
  }

  // Step 4: fetch the PDF from Firma's CDN server-side
  let pdfRes: Response;
  try {
    pdfRes = await fetch(signedPdfUrl);
  } catch (err) {
    console.error("[download-signed] Failed to fetch signed PDF from URL:", err);
    return NextResponse.json({ error: "Failed to fetch signed PDF" }, { status: 502 });
  }

  if (!pdfRes.ok) {
    console.error(`[download-signed] CDN returned ${pdfRes.status} for signed PDF URL`);
    return NextResponse.json(
      { error: `Could not retrieve the signed PDF (upstream ${pdfRes.status})` },
      { status: 502 }
    );
  }

  const pdfBuffer = await pdfRes.arrayBuffer();

  // Step 5: look up quote name for a friendly filename
  const { data: quote } = await supabase
    .from("quotes")
    .select("quote_number, quote_name")
    .eq("id", quoteId)
    .maybeSingle();

  const safeName = quote?.quote_name
    ? quote.quote_name.replace(/[^a-z0-9\-_ ]/gi, "").trim()
    : "proposal";
  const filename = `${safeName}_signed.pdf`;

  console.log(`[download-signed] ✅ done | quoteId: ${quoteId} | bytes: ${pdfBuffer.byteLength} | file: ${filename}`);

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": viewMode
        ? `inline; filename="${filename}"`
        : `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
