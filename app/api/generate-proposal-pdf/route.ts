import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateExportToken } from "@/lib/proposal/exportToken";

export async function POST(req: NextRequest) {
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

  // ── 3. Ownership check ───────────────────────────────────────────────────
  // Verify the authenticated user belongs to the organization that owns this
  // proposal. We join quote_proposals → quotes (to get the org) → organization_memberships.
  // This query returns a row only when the user is an org member.
  const { data: accessCheck, error: accessError } = await supabase
    .from("quote_proposals")
    .select(
      `
      id,
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

  if (!accessCheck) {
    // Either the proposal does not exist or the user does not own it — return 403
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── 4. Verify PDFShift API key is configured ─────────────────────────────
  const apiKey = process.env.PDFSHIFT_API_KEY;
  if (!apiKey || apiKey === "your_key_here") {
    console.error("[generate-proposal-pdf] PDFSHIFT_API_KEY is not configured");
    return NextResponse.json({ error: "PDF service not configured" }, { status: 503 });
  }

  // ── 5. Build the signed export URL ──────────────────────────────────────
  // NEXT_PUBLIC_SITE_URL must be set to the publicly accessible domain in production.
  // PDFShift cannot reach localhost — use ngrok or a staging URL locally.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (!siteUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_SITE_URL is not configured" }, { status: 503 });
  }

  let token: string;
  try {
    token = generateExportToken(quoteId);
  } catch (tokenErr) {
    console.error("[generate-proposal-pdf] Token generation failed:", tokenErr);
    return NextResponse.json({ error: "PDF service not configured" }, { status: 503 });
  }

  const exportUrl = `${siteUrl}/proposal/export/${quoteId}?token=${encodeURIComponent(token)}`;

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
        source: exportUrl,
        landscape: false,
        use_print: true,
        // Give the page 1.5 s after load for images/fonts to finish rendering.
        delay: 1500,
        // Bypass the ngrok browser-warning interstitial page that appears on
        // free ngrok tunnels. Remove this in production (non-ngrok deployments
        // ignore unknown headers, so it is safe to leave in place).
        http_headers: {
          "ngrok-skip-browser-warning": "1",
        },
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
  const safeFilename = quoteName.replace(/[^\w\-. ]/g, "").trim() || "proposal";

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeFilename}.pdf"`,
      "Content-Length": String(pdfBuffer.byteLength),
    },
  });
}
