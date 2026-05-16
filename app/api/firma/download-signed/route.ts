/**
 * GET /api/firma/download-signed?quoteId=...
 *
 * Server-side proxy that fetches the Firma-signed PDF for a completed
 * signing request and streams it back to the browser as a downloadable
 * attachment. Bypasses browser CORS restrictions on Firma's CDN URLs.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

export async function GET(req: NextRequest) {
  const quoteId = req.nextUrl.searchParams.get("quoteId");
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
    .select("id")
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (proposalErr) {
    console.error("[download-signed] proposal lookup error:", proposalErr.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!proposal) {
    return NextResponse.json({ error: "No proposal found for this quote" }, { status: 404 });
  }

  // Step 2: look up the signed PDF URL via service client (bypasses RLS)
  const db = getServiceClient();
  const { data: sigRow, error: sigErr } = await db
    .from("proposal_signatures")
    .select("signed_pdf_url, status")
    .eq("proposal_id", proposal.id)
    .maybeSingle();

  if (sigErr) {
    console.error("[download-signed] signature lookup error:", sigErr.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!sigRow?.signed_pdf_url) {
    return NextResponse.json(
      { error: "No signed PDF available for this document" },
      { status: 404 }
    );
  }

  // Step 3: fetch the PDF from Firma's CDN server-side
  let pdfRes: Response;
  try {
    pdfRes = await fetch(sigRow.signed_pdf_url);
  } catch (err) {
    console.error("[download-signed] Failed to fetch signed PDF:", err);
    return NextResponse.json({ error: "Failed to fetch signed PDF" }, { status: 502 });
  }

  if (!pdfRes.ok) {
    console.error(`[download-signed] Firma CDN returned ${pdfRes.status}`);
    return NextResponse.json(
      { error: `Upstream error: ${pdfRes.status}` },
      { status: 502 }
    );
  }

  const pdfBuffer = await pdfRes.arrayBuffer();

  // Step 4: look up quote name for a friendly filename
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
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
