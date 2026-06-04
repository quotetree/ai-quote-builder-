import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import type { TemplatePage } from "@/components/proposal-template/proposalTemplateTypes";
import { buildProposalHtml, prefetchProposalImages } from "@/lib/proposal/buildProposalHtml";
import { fetchEmbeddedQuoteData } from "@/lib/proposal/fetchEmbeddedQuoteData";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  // ── 1. Parse request body ────────────────────────────────────────────────
  let quoteId: string;
  let quoteName: string;
  try {
    const body = await req.json();
    quoteId = body.quoteId;
    quoteName = body.quoteName ?? "proposal";
    if (!quoteId || typeof quoteId !== "string") {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── 2. Authenticate the requesting user ──────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 3. Ownership check + load proposal pages ─────────────────────────────
  const { data: proposal, error: accessError } = await supabase
    .from("quote_proposals")
    .select(
      `
      id,
      pages,
      organization_id,
      quotes!inner ( id ),
      organizations!inner (
        organization_memberships!inner ( user_id )
      )
    `
    )
    .eq("quote_id", quoteId)
    .eq("organizations.organization_memberships.user_id", user.id)
    .maybeSingle();

  if (accessError) {
    console.error("[generate-proposal-pdf] Access check error:", accessError);
    return NextResponse.json({ error: "Failed to verify access" }, { status: 500 });
  }

  if (!proposal) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const pages: TemplatePage[] = Array.isArray(proposal.pages) ? proposal.pages : [];
  if (pages.length === 0) {
    return NextResponse.json(
      { error: "No proposal pages to export. Open Edit Proposal and save first." },
      { status: 422 }
    );
  }

  // ── 4. Verify PDFShift API key is configured ─────────────────────────────
  const apiKey = process.env.PDFSHIFT_API_KEY?.trim();
  if (!apiKey || apiKey === "your_key_here") {
    console.error("[generate-proposal-pdf] PDFSHIFT_API_KEY is not configured");
    return NextResponse.json(
      {
        error:
          "PDFShift is not configured. Add PDFSHIFT_API_KEY in your Vercel environment variables and redeploy.",
      },
      { status: 503 }
    );
  }

  // ── 5. Build self-contained HTML (direct to PDFShift — no URL fetch) ─────
  const admin = getServiceClient();
  const quoteDataMap = await fetchEmbeddedQuoteData(admin, pages);

  const logoUrls = Object.values(quoteDataMap)
    .map((d) => d.profile?.company_logo_url)
    .filter((url): url is string => !!url && !url.startsWith("data:"));

  const imgMap = await prefetchProposalImages(pages, logoUrls);
  const proposalHtml = buildProposalHtml(pages, imgMap, quoteDataMap);
  const htmlSizeKB = Math.round(proposalHtml.length / 1024);

  if (proposalHtml.length < 2_000) {
    return NextResponse.json(
      { error: "The proposal appears to have no renderable content." },
      { status: 422 }
    );
  }

  console.log(
    `[generate-proposal-pdf] HTML ready — pages=${pages.length} html=${htmlSizeKB}KB ` +
    `images=${Object.keys(imgMap).length} quotes=${Object.keys(quoteDataMap).length} ` +
    `prep=${Date.now() - startedAt}ms`
  );

  // ── 6. Call PDFShift ─────────────────────────────────────────────────────
  let pdfShiftResponse: Response;
  try {
    pdfShiftResponse = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: proposalHtml,
        landscape: false,
        use_print: true,
        delay: 500,
        viewport: "816x1056",
      }),
    });
  } catch (fetchErr) {
    console.error("[generate-proposal-pdf] PDFShift network error:", fetchErr);
    return NextResponse.json({ error: "Failed to reach PDF service" }, { status: 502 });
  }

  if (!pdfShiftResponse.ok) {
    const body = await pdfShiftResponse.text().catch(() => "");
    console.error("[generate-proposal-pdf] PDFShift error:", pdfShiftResponse.status, body);
    return NextResponse.json(
      { error: `PDF service returned ${pdfShiftResponse.status}` },
      { status: 502 }
    );
  }

  // ── 7. Stream PDF back to the browser ────────────────────────────────────
  const pdfBuffer = await pdfShiftResponse.arrayBuffer();
  const pdfSizeKB = Math.round(pdfBuffer.byteLength / 1024);
  const safeFilename = quoteName.replace(/[^\w\-. ]/g, "").trim() || "proposal";

  console.log(
    `[generate-proposal-pdf] ✅ done | quoteId=${quoteId} | pages=${pages.length} | ` +
    `pdf=${pdfSizeKB}KB | html=${htmlSizeKB}KB | total=${Date.now() - startedAt}ms`
  );

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeFilename}.pdf"`,
      "Content-Length": String(pdfBuffer.byteLength),
    },
  });
}
