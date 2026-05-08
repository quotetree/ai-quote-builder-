import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import {
  getOrCreateFirmaWorkspace,
  createSigningRequestWithLinks,
  FirmaNoSigningUrlError,
  type FirmaRecipient,
} from "@/lib/firma";
import {
  prefetchProposalImages,
  buildProposalHtml,
} from "@/lib/proposal/buildProposalHtml";
import {
  type TemplatePage,
  ELEMENT_LABELS,
} from "@/components/proposal-template/proposalTemplateTypes";

const SIGNING_FIELD_TYPES = new Set(["signature", "initial", "date", "checkbox"]);

export async function POST(req: NextRequest) {
  // ── 1. Parse body ────────────────────────────────────────────────────────────
  let quoteId: string;
  let quoteName: string;
  try {
    const body = await req.json();
    quoteId = body.quoteId;
    quoteName = body.quoteName ?? "Proposal";
    if (!quoteId || typeof quoteId !== "string") {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── 2. Authenticate ──────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 3. Load proposal ─────────────────────────────────────────────────────────
  const { data: proposal, error: proposalErr } = await supabase
    .from("quote_proposals")
    .select("id, organization_id, recipients, pages")
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (proposalErr) {
    console.error("[firma/create] Proposal fetch error:", proposalErr.message);
    return NextResponse.json({ error: "Failed to load proposal" }, { status: 500 });
  }
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found. Save the proposal before generating signing links." }, { status: 404 });
  }

  // Guard: if pages are empty the PDF will be blank
  const proposalPages: unknown[] = Array.isArray(proposal.pages) ? proposal.pages : [];
  console.log(
    `[firma/create] proposal id=${proposal.id}  pages=${proposalPages.length}  ` +
    `bgImages=${
      proposalPages.filter((p) => typeof p === "object" && p !== null && "backgroundImage" in p && !!(p as Record<string, unknown>).backgroundImage).length
    }`
  );
  if (proposalPages.length === 0) {
    return NextResponse.json(
      { error: "The proposal has no pages. Please add content and save the proposal before sending for signature." },
      { status: 422 }
    );
  }

  // ── 3b. Verify user belongs to the proposal's organization ───────────────────
  const { data: membership, error: memberErr } = await supabase
    .from("organization_memberships")
    .select("user_id")
    .eq("organization_id", proposal.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberErr) {
    console.error("[firma/create] Membership check error:", memberErr.message);
    return NextResponse.json({ error: "Failed to verify access" }, { status: 500 });
  }
  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // ── 3c. Load org name for workspace creation ──────────────────────────────────
  const { data: org } = await supabase
    .from("organizations")
    .select("organization_name")
    .eq("id", proposal.organization_id)
    .maybeSingle();

  // ── 4. Validate recipients ───────────────────────────────────────────────────
  const rawRecipients: Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    role: "signer" | "cc";
  }> = Array.isArray(proposal.recipients) ? proposal.recipients : [];

  const signers = rawRecipients.filter((r) => r.role === "signer");
  if (signers.length === 0) {
    return NextResponse.json(
      { error: "At least one signer recipient is required before sending." },
      { status: 422 }
    );
  }

  // ── 4b. Validate that every unexecuted signing field has an explicit signer assigned ────
  // Fields use element.variableName to store the assigned recipient's email.
  // Fields that already have content (executed by the sender) are skipped —
  // they will be burned into the PDF and not sent to Firma as interactive fields.
  const signerEmailSet = new Set(signers.map((s) => s.email.toLowerCase()));
  const unassigned: string[] = [];

  for (let pi = 0; pi < (proposalPages as TemplatePage[]).length; pi++) {
    const page = (proposalPages as TemplatePage[])[pi];
    for (const el of page.elements) {
      if (!SIGNING_FIELD_TYPES.has(el.type)) continue;
      // Skip executed fields — they don't go to Firma and need no assignment
      if (el.content && el.content.length > 0) continue;
      const assignedEmail = (el.variableName ?? "").trim().toLowerCase();
      if (!assignedEmail) {
        unassigned.push(`Page ${pi + 1}: ${ELEMENT_LABELS[el.type] ?? el.type} — no signer assigned`);
      } else if (!signerEmailSet.has(assignedEmail)) {
        unassigned.push(`Page ${pi + 1}: ${ELEMENT_LABELS[el.type] ?? el.type} — assigned to unknown recipient (${assignedEmail})`);
      }
    }
  }

  if (unassigned.length > 0) {
    console.error("[firma/create] Unassigned signing fields:", unassigned);
    return NextResponse.json(
      {
        error:
          `All signing fields must be assigned to a recipient before generating links.\n\n` +
          unassigned.map((s) => `• ${s}`).join("\n"),
      },
      { status: 422 }
    );
  }

  // ── 5. Validate env ──────────────────────────────────────────────────────────
  const firmaApiKey = process.env.FIRMA_API_KEY;
  if (!firmaApiKey) {
    console.error("[firma/create] FIRMA_API_KEY is not configured");
    return NextResponse.json({ error: "E-signature service not configured" }, { status: 503 });
  }

  const pdfShiftKey = process.env.PDFSHIFT_API_KEY;
  if (!pdfShiftKey || pdfShiftKey === "your_key_here") {
    console.error("[firma/create] PDFSHIFT_API_KEY is not configured");
    return NextResponse.json({ error: "PDF service not configured" }, { status: 503 });
  }

  // DEBUG: log environment configuration so we can spot sandbox/production mismatches
  console.log(
    "[firma/create][debug] env check:" +
    `\n  FIRMA_API_KEY  = ${firmaApiKey.slice(0, 16)}… (len=${firmaApiKey.length})` +
    `\n  NODE_ENV       = ${process.env.NODE_ENV ?? "(not set)"}` +
    `\n  VERCEL_ENV     = ${process.env.VERCEL_ENV ?? "(not set)"}`
  );

  // ── 6. Generate PDF via PDFShift (direct HTML, no URL fetch) ────────────────
  //
  // The proposal HTML is built entirely server-side from the saved pages data,
  // with all background images embedded as base64 data URIs.  The resulting
  // HTML string is passed directly to PDFShift as `source` — no URL, no ngrok,
  // no public-server dependency of any kind.
  let pdfBase64: string;
  try {
    const pages = proposalPages as TemplatePage[];

    // ── Content counts for logging and validation ───────────────────────────
    const pageCount    = pages.length;
    const elementCount = pages.reduce((n, p) => n + p.elements.length, 0);
    const bgImageCount = pages.filter((p) => !!p.backgroundImage).length;
    const imgElCount   = pages.reduce(
      (n, p) => n + p.elements.filter((e) => e.type === "image").length,
      0
    );

    // ── Pre-fetch all remote images as base64 ───────────────────────────────
    console.log(
      `[firma/create] building HTML — ` +
      `pages=${pageCount}  elements=${elementCount}  ` +
      `bgImages=${bgImageCount}  imgElements=${imgElCount}`
    );
    const imgMap = await prefetchProposalImages(pages);
    console.log(
      `[firma/create] image pre-fetch complete — ` +
      `fetched=${Object.keys(imgMap).length}  ` +
      `requested=${bgImageCount + imgElCount}`
    );

    // ── Build the HTML ──────────────────────────────────────────────────────
    const proposalHtml = buildProposalHtml(pages, imgMap);
    const htmlSizeKB   = Math.round(proposalHtml.length / 1024);
    console.log(
      `[firma/create] HTML built — ` +
      `htmlSize=${htmlSizeKB} KB  pages=${pageCount}  elements=${elementCount}`
    );

    // Guard: empty HTML wrapper (no actual content) — would produce a blank PDF
    // A real proposal page with even a single background image generates >50 KB of HTML.
    // If the HTML is under 2 KB it contains nothing but the document skeleton.
    if (proposalHtml.length < 2_000) {
      console.error(
        `[firma/create] HTML too small (${htmlSizeKB} KB) — proposal has no renderable content. ` +
        `pages=${pageCount}  bgImages=${bgImageCount}  elements=${elementCount}`
      );
      return NextResponse.json(
        {
          error:
            "The proposal appears to have no content. " +
            "Add pages or elements, save the proposal, then try again.",
        },
        { status: 422 }
      );
    }

    // ── Call PDFShift ───────────────────────────────────────────────────────
    const pdfRes = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${pdfShiftKey}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: proposalHtml,   // raw HTML — no URL, no ngrok
        landscape: false,
        use_print: true,
        // No delay needed: all images are embedded as base64 data URIs.
        delay: 500,
        // PDFShift viewport must be a "WIDTHxHEIGHT" string, not an object.
        // 816 × 1056 matches US Letter at 96 dpi (the proposal canvas size).
        viewport: "816x1056",
      }),
    });

    if (!pdfRes.ok) {
      const errBody = await pdfRes.text().catch(() => "");
      console.error("[firma/create] PDFShift error:", pdfRes.status, errBody);
      return NextResponse.json(
        { error: `PDF generation failed (${pdfRes.status})` },
        { status: 502 }
      );
    }

    const pdfBuffer  = await pdfRes.arrayBuffer();
    const pdfSizeKB  = Math.round(pdfBuffer.byteLength / 1024);
    console.log(
      `[firma/create] PDF generated — ` +
      `pdfSize=${pdfSizeKB} KB  htmlSize=${htmlSizeKB} KB  pages=${pageCount}`
    );

    // ── Hard check: refuse to send a blank PDF to Firma ─────────────────────
    // A real multi-page proposal with background images is always well over
    // 100 KB.  Anything under 20 KB means PDFShift rendered an empty document.
    if (pdfBuffer.byteLength < 20_000) {
      console.error(
        `[firma/create] PDF too small — ${pdfSizeKB} KB. ` +
        `Refusing to send a blank document to Firma. ` +
        `htmlSize=${htmlSizeKB} KB  pages=${pageCount}  bgImages=${bgImageCount}`
      );
      return NextResponse.json(
        {
          error:
            `PDF generation produced a blank document (${pdfSizeKB} KB). ` +
            "Make sure the proposal has saved pages with content, then try again.",
        },
        { status: 422 }
      );
    }

    pdfBase64 = Buffer.from(pdfBuffer).toString("base64");
  } catch (pdfErr: unknown) {
    const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
    console.error("[firma/create] PDF generation threw:", msg);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 502 });
  }

  // ── 7. Get or create Firma workspace for this org ────────────────────────────
  const organizationId: string = proposal.organization_id;
  const orgName: string = org?.organization_name ?? `org-${organizationId.slice(0, 8)}`;

  let workspaceApiKey: string;
  try {
    workspaceApiKey = await getOrCreateFirmaWorkspace(organizationId, orgName);
    console.log(
      `[firma/create][debug] workspace key for org ${organizationId.slice(0, 8)}: ` +
      `${workspaceApiKey.slice(0, 16)}… (len=${workspaceApiKey.length})`
    );
  } catch (wsErr: unknown) {
    const msg = wsErr instanceof Error ? wsErr.message : String(wsErr);
    console.error("[firma/create] Workspace error:", msg);
    return NextResponse.json({ error: "Failed to initialize e-signature workspace" }, { status: 502 });
  }

  // ── 8. Build recipients array for Firma ─────────────────────────────────────
  // All recipients share order: 1 so Firma treats them as a parallel signing
  // group — every signer receives the request immediately and no one waits for
  // another signer to complete first.
  const firmaRecipients: FirmaRecipient[] = rawRecipients.map((r) => ({
    first_name: r.first_name,
    last_name: r.last_name || "",
    email: r.email,
    designation: r.role === "signer" ? "Signer" : "CC",
    order: 1,
  }));

  // ── 9. Create Firma signing request ──────────────────────────────────────────
  let signerLinks: Array<{ email: string; name: string; firma_user_id: string; signing_url: string }>;
  let firmaSigningRequestId: string;
  try {
    const safeFilename = quoteName.replace(/[^\w\-. ]/g, "").trim() || "proposal";
    const { signingRequest, signerLinks: links } = await createSigningRequestWithLinks(
      workspaceApiKey,
      {
        name: `${safeFilename} — ${new Date().toLocaleDateString()}`,
        pdfBase64,
        recipients: firmaRecipients,
        pages: proposalPages as TemplatePage[],
      }
    );
    firmaSigningRequestId = signingRequest.id;
    signerLinks = links;
    console.log("[firma/create] Signing request created:", firmaSigningRequestId, "signers:", signerLinks.length);

    // DEBUG: log each recipient token so we can compare against what the DB stores
    for (const link of signerLinks) {
      console.log(
        `[firma/create][debug] signer link:` +
        `\n  email          = ${link.email}` +
        `\n  name           = ${link.name}` +
        `\n  firma_user_id  = ${link.firma_user_id}` +
        `\n  signing_url    = ${link.signing_url}`
      );
    }
  } catch (firmaErr: unknown) {
    if (firmaErr instanceof FirmaNoSigningUrlError) {
      // Log the full technical diagnostic server-side; send only the clean
      // user-facing sentence to the browser.
      console.error("[firma/create] No official signing URL from Firma:", firmaErr.diagnostic);
      return NextResponse.json({ error: firmaErr.message }, { status: 422 });
    }
    const msg = firmaErr instanceof Error ? firmaErr.message : String(firmaErr);
    console.error("[firma/create] Firma API error:", msg);
    return NextResponse.json({ error: `E-signature service error: ${msg}` }, { status: 502 });
  }

  // ── 10. Upsert proposal_signatures row ───────────────────────────────────────
  const primarySigner = signerLinks.find((l) => {
    const rec = rawRecipients.find((r) => r.email.toLowerCase() === l.email.toLowerCase());
    return rec?.role === "signer";
  }) ?? signerLinks[0];

  const db = getServiceClient();
  const { error: upsertErr } = await db
    .from("proposal_signatures")
    .upsert(
      {
        proposal_id: proposal.id,
        organization_id: organizationId,
        customer_name: primarySigner?.name ?? null,
        customer_email: primarySigner?.email ?? null,
        firma_signing_request_id: firmaSigningRequestId,
        firma_signing_request_user_id: primarySigner?.firma_user_id ?? null,
        signing_url: primarySigner?.signing_url ?? null,
        all_signers_data: signerLinks,
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "proposal_id" }
    );

  if (upsertErr) {
    console.error("[firma/create] Supabase upsert error:", upsertErr.message);
    // Non-fatal — still return the links to the user
  } else {
    // DEBUG: read back what was stored so we can verify token/URL fidelity in the DB
    const { data: storedRow } = await db
      .from("proposal_signatures")
      .select("id, status, firma_signing_request_id, firma_signing_request_user_id, signing_url, all_signers_data, sent_at")
      .eq("proposal_id", proposal.id)
      .maybeSingle();

    if (storedRow) {
      console.log(
        `[firma/create][debug] DB row after upsert:` +
        `\n  id                              = ${storedRow.id}` +
        `\n  status                          = ${storedRow.status}` +
        `\n  firma_signing_request_id        = ${storedRow.firma_signing_request_id}` +
        `\n  firma_signing_request_user_id   = ${storedRow.firma_signing_request_user_id}` +
        `\n  signing_url (primary)           = ${storedRow.signing_url}` +
        `\n  sent_at                         = ${storedRow.sent_at}` +
        `\n  all_signers_data                = ${JSON.stringify(storedRow.all_signers_data)}`
      );
    } else {
      console.warn("[firma/create][debug] DB read-back returned no row for proposal_id:", proposal.id);
    }
  }

  // ── 11. Upsert contacts for autocomplete ────────────────────────────────────
  const contactRows = rawRecipients.map((r) => ({
    organization_id: organizationId,
    first_name: r.first_name,
    last_name: r.last_name || "",
    email: r.email,
    phone: r.phone ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error: contactErr } = await db
    .from("proposal_contacts")
    .upsert(contactRows, { onConflict: "organization_id,email", ignoreDuplicates: false });

  if (contactErr) {
    console.error("[firma/create] Contact upsert error:", contactErr.message);
  }

  // ── 12. Return signer links ──────────────────────────────────────────────────
  return NextResponse.json({
    firma_signing_request_id: firmaSigningRequestId,
    signer_links: signerLinks,
    status: "sent",
  });
}

// ─── DELETE — invalidate / clear a signing request ───────────────────────────
//
// Called when the user chooses "Edit document" after a signing link has been
// sent.  Deletes the proposal_signatures row so the document returns to draft
// state.  The proposal itself (quote_proposals) is never touched.
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const proposalId = searchParams.get("proposalId");
  if (!proposalId || typeof proposalId !== "string") {
    return NextResponse.json({ error: "proposalId is required" }, { status: 400 });
  }

  // Authenticate
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify the proposal exists and belongs to the user's organization
  const { data: proposal, error: proposalErr } = await supabase
    .from("quote_proposals")
    .select("id, organization_id")
    .eq("id", proposalId)
    .maybeSingle();

  if (proposalErr) {
    console.error("[firma/delete] Proposal fetch error:", proposalErr.message);
    return NextResponse.json({ error: "Failed to load proposal" }, { status: 500 });
  }
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  // Verify membership
  const { data: membership, error: memberErr } = await supabase
    .from("organization_memberships")
    .select("user_id")
    .eq("organization_id", proposal.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberErr) {
    console.error("[firma/delete] Membership check error:", memberErr.message);
    return NextResponse.json({ error: "Failed to verify access" }, { status: 500 });
  }
  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Delete the signing request record — the proposal pages are untouched
  const db = getServiceClient();
  const { error: deleteErr } = await db
    .from("proposal_signatures")
    .delete()
    .eq("proposal_id", proposalId);

  if (deleteErr) {
    console.error("[firma/delete] DB delete error:", deleteErr.message);
    return NextResponse.json({ error: "Failed to clear signing data" }, { status: 500 });
  }

  console.log("[firma/delete] Cleared signing request for proposal:", proposalId);
  return NextResponse.json({ success: true });
}
