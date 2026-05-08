/**
 * GET /api/firma/diagnose
 *
 * Hard diagnostic trace for the Firma signing flow.
 * Runs the exact same steps as sync-status but returns every raw API
 * response, every DB value, and every mapping decision so failures are
 * visible without requiring access to Vercel function logs.
 *
 * Accepts any ONE of these query params — use whichever you can see:
 *
 *   ?quoteId=<uuid>
 *       Internal quote UUID (not shown in the QuoteTree UI).
 *
 *   ?projectId=<uuid>&quoteNumber=Q-001
 *       Project UUID from the browser URL (/projects/<projectId>)
 *       + the quote number shown in the sidebar (e.g. Q-001).
 *
 *   ?firmaId=<string>
 *       The firma_signing_request_id visible in the Firma dashboard.
 *
 * Requires an active QuoteTree session (same auth gate as sync-status).
 * Never returns secret key values — only boolean presence and safe identifiers.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import { getOrCreateFirmaWorkspace } from "@/lib/firma";

const FIRMA_API_BASE = "https://api.firma.dev/functions/v1/signing-request-api";

function mapFirmaStatus(raw: string): string | null {
  switch (raw.toLowerCase()) {
    case "completed":
    case "signed":
      return "completed";
    case "declined":
    case "rejected":
    case "cancelled":
    case "canceled":
      return "declined";
    case "expired":
      return "expired";
    case "sent":
    case "pending":
    case "in_progress":
      return "sent";
    case "viewed":
      return "viewed";
    default:
      return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const quoteId     = searchParams.get("quoteId");
  const projectId   = searchParams.get("projectId");
  const quoteNumber = searchParams.get("quoteNumber");
  const firmaId     = searchParams.get("firmaId");

  const trace: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    inputParams: { quoteId, projectId, quoteNumber, firmaId },
    howToUse: {
      option1: "?quoteId=<uuid>  — internal quote UUID (not shown in the UI)",
      option2: "?projectId=<uuid>&quoteNumber=Q-001  — project UUID from the browser URL + quote number from the sidebar",
      option3: "?firmaId=<signing_request_id>  — firma_signing_request_id from the Firma dashboard",
    },
    envVars: {
      FIRMA_API_KEY:                 !!process.env.FIRMA_API_KEY,
      FIRMA_WEBHOOK_SECRET:          !!process.env.FIRMA_WEBHOOK_SECRET,
      PDFSHIFT_API_KEY:              !!process.env.PDFSHIFT_API_KEY,
      SUPABASE_SERVICE_ROLE_KEY:     !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL:      !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
  };

  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized", trace }, { status: 401 });
  }
  trace.auth = { userId: user.id, email: user.email };

  if (!quoteId && !firmaId && !(projectId && quoteNumber)) {
    return NextResponse.json({
      error: "Provide one of: quoteId, firmaId, or projectId+quoteNumber",
      trace,
    }, { status: 400 });
  }

  const db = getServiceClient();

  // ── 2. Resolve to a proposal_signatures row ───────────────────────────────────
  // All three input modes converge here. sigRow always has organization_id
  // (from the proposal_signatures schema) so we never need a second lookup.

  let sigRow: Record<string, unknown> | null = null;

  // Mode A: direct firmaId lookup — fastest, no quote_proposals join needed
  if (firmaId) {
    const { data, error } = await db
      .from("proposal_signatures")
      .select(
        "id, proposal_id, organization_id, status, firma_signing_request_id, " +
        "firma_signing_request_user_id, signing_url, signed_pdf_url, " +
        "audit_trail_url, all_signers_data, sent_at, completed_at, updated_at"
      )
      .eq("firma_signing_request_id", firmaId)
      .maybeSingle();

    trace.step2_lookup = {
      mode: "firmaId",
      firmaId,
      found: !!data,
      error: error?.message ?? null,
    };

    if (error || !data) {
      return NextResponse.json({
        error: `No proposal_signatures row found for firmaId "${firmaId}"`,
        trace,
      });
    }
    sigRow = data as unknown as Record<string, unknown>;
  }

  // Mode B: projectId + quoteNumber → resolve quoteId → quote_proposals → proposal_signatures
  if (!sigRow && projectId && quoteNumber) {
    const { data: quoteData, error: quoteErr } = await supabase
      .from("quotes")
      .select("id, quote_number, quote_name")
      .eq("project_id", projectId)
      .eq("quote_number", quoteNumber)
      .maybeSingle();

    trace.step2_lookup = {
      mode: "projectId+quoteNumber",
      projectId,
      quoteNumber,
      quoteFound: !!quoteData,
      quoteError: quoteErr?.message ?? null,
      resolvedQuoteId: quoteData?.id ?? null,
    };

    if (quoteErr || !quoteData) {
      return NextResponse.json({
        error: `No quote found with number "${quoteNumber}" in project "${projectId}"`,
        trace,
      });
    }

    const { data: propData, error: propErr } = await supabase
      .from("quote_proposals")
      .select("id, organization_id")
      .eq("quote_id", quoteData.id)
      .maybeSingle();

    (trace.step2_lookup as Record<string, unknown>).proposalFound = !!propData;
    (trace.step2_lookup as Record<string, unknown>).proposalError = propErr?.message ?? null;
    (trace.step2_lookup as Record<string, unknown>).proposalId = propData?.id ?? null;

    if (propErr || !propData) {
      return NextResponse.json({
        error: "No quote_proposals row found for that quote. Has the proposal been opened at least once?",
        trace,
      });
    }

    const { data: sigData, error: sigErr } = await db
      .from("proposal_signatures")
      .select(
        "id, proposal_id, organization_id, status, firma_signing_request_id, " +
        "firma_signing_request_user_id, signing_url, signed_pdf_url, " +
        "audit_trail_url, all_signers_data, sent_at, completed_at, updated_at"
      )
      .eq("proposal_id", propData.id)
      .maybeSingle();

    (trace.step2_lookup as Record<string, unknown>).sigFound = !!sigData;
    (trace.step2_lookup as Record<string, unknown>).sigError = sigErr?.message ?? null;

    if (sigErr || !sigData) {
      return NextResponse.json({
        error: "No proposal_signatures row found. Has a signing request been sent for this quote?",
        trace,
      });
    }
    sigRow = sigData as unknown as Record<string, unknown>;
  }

  // Mode C: direct quoteId UUID
  if (!sigRow && quoteId) {
    const { data: propData, error: propErr } = await supabase
      .from("quote_proposals")
      .select("id, organization_id")
      .eq("quote_id", quoteId)
      .maybeSingle();

    trace.step2_lookup = {
      mode: "quoteId",
      quoteId,
      proposalFound: !!propData,
      proposalError: propErr?.message ?? null,
      proposalId: propData?.id ?? null,
    };

    if (propErr || !propData) {
      return NextResponse.json({
        error: "No quote_proposals row found for that quoteId. Check the UUID and try again.",
        trace,
      });
    }

    const { data: sigData, error: sigErr } = await db
      .from("proposal_signatures")
      .select(
        "id, proposal_id, organization_id, status, firma_signing_request_id, " +
        "firma_signing_request_user_id, signing_url, signed_pdf_url, " +
        "audit_trail_url, all_signers_data, sent_at, completed_at, updated_at"
      )
      .eq("proposal_id", propData.id)
      .maybeSingle();

    (trace.step2_lookup as Record<string, unknown>).sigFound = !!sigData;
    (trace.step2_lookup as Record<string, unknown>).sigError = sigErr?.message ?? null;

    if (sigErr || !sigData) {
      return NextResponse.json({
        error: "No proposal_signatures row found. Has a signing request been sent for this quote?",
        trace,
      });
    }
    sigRow = sigData as unknown as Record<string, unknown>;
  }

  if (!sigRow) {
    return NextResponse.json({ error: "Could not resolve a proposal_signatures row", trace });
  }

  // ── 3. Show the full proposal_signatures row ──────────────────────────────────
  trace.step3_signatureRow = {
    id:                           sigRow.id,
    proposal_id:                  sigRow.proposal_id,
    organization_id:              sigRow.organization_id,
    status:                       sigRow.status,
    firma_signing_request_id:     sigRow.firma_signing_request_id,
    firma_signing_request_user_id:sigRow.firma_signing_request_user_id,
    signing_url:                  sigRow.signing_url,
    signed_pdf_url:               sigRow.signed_pdf_url,
    audit_trail_url:              sigRow.audit_trail_url,
    all_signers_data:             sigRow.all_signers_data,
    sent_at:                      sigRow.sent_at,
    completed_at:                 sigRow.completed_at,
    updated_at:                   sigRow.updated_at,
  };

  const firmaRequestId = sigRow.firma_signing_request_id as string | null;
  if (!firmaRequestId) {
    return NextResponse.json({ error: "firma_signing_request_id is null — no signing request has been sent yet", trace });
  }

  // ── 4. Get Firma workspace key ───────────────────────────────────────────────
  const organizationId = sigRow.organization_id as string;
  let workspaceApiKey: string | null = null;
  try {
    workspaceApiKey = await getOrCreateFirmaWorkspace(organizationId);
    trace.step4_workspaceLookup = {
      success: true,
      keyPresent: !!workspaceApiKey,
      keyLength: workspaceApiKey.length,
      keyPrefix: workspaceApiKey.slice(0, 12) + "…",
    };
  } catch (err) {
    trace.step4_workspaceLookup = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
    return NextResponse.json({ error: "Workspace key lookup failed", trace });
  }

  // ── 5. Firma GET /signing-requests/{id} ——— full raw response ─────────────────
  let firmaGetHttpStatus: number | null = null;
  let firmaGetRawBody: unknown = null;
  try {
    const res = await fetch(
      `${FIRMA_API_BASE}/signing-requests/${firmaRequestId}`,
      { headers: { Authorization: `Bearer ${workspaceApiKey}`, "Content-Type": "application/json" } }
    );
    firmaGetHttpStatus = res.status;
    const text = await res.text();
    try { firmaGetRawBody = JSON.parse(text); } catch { firmaGetRawBody = text; }

    trace.step5_firmaGetSigningRequest = {
      url: `${FIRMA_API_BASE}/signing-requests/${firmaRequestId}`,
      httpStatus: firmaGetHttpStatus,
      rawResponse: firmaGetRawBody,
    };
  } catch (err) {
    trace.step5_firmaGetSigningRequest = { httpStatus: null, error: err instanceof Error ? err.message : String(err) };
  }

  // ── 6. Firma GET /signing-requests/{id}/users ——— full raw response ───────────
  let firmaUsersHttpStatus: number | null = null;
  let firmaUsersRawBody: unknown = null;
  try {
    const res = await fetch(
      `${FIRMA_API_BASE}/signing-requests/${firmaRequestId}/users`,
      { headers: { Authorization: `Bearer ${workspaceApiKey}`, "Content-Type": "application/json" } }
    );
    firmaUsersHttpStatus = res.status;
    const text = await res.text();
    try { firmaUsersRawBody = JSON.parse(text); } catch { firmaUsersRawBody = text; }

    trace.step6_firmaGetUsers = {
      url: `${FIRMA_API_BASE}/signing-requests/${firmaRequestId}/users`,
      httpStatus: firmaUsersHttpStatus,
      rawResponse: firmaUsersRawBody,
    };
  } catch (err) {
    trace.step6_firmaGetUsers = { httpStatus: null, error: err instanceof Error ? err.message : String(err) };
  }

  // ── 7. Status mapping trace ───────────────────────────────────────────────────
  const rawRecord = firmaGetRawBody as Record<string, unknown> | null;
  const rawFirmaStatus =
    (rawRecord?.status as string | undefined) ??
    ((rawRecord?.data as Record<string, unknown> | undefined)?.status as string | undefined) ??
    null;

  const rawDocumentUrl =
    (rawRecord?.document_url as string | undefined) ??
    (rawRecord?.signed_pdf_url as string | undefined) ??
    ((rawRecord?.data as Record<string, unknown> | undefined)?.document_url as string | undefined) ??
    ((rawRecord?.data as Record<string, unknown> | undefined)?.signed_pdf_url as string | undefined) ??
    null;

  const rawAuditTrailUrl =
    (rawRecord?.audit_trail_url as string | undefined) ??
    ((rawRecord?.data as Record<string, unknown> | undefined)?.audit_trail_url as string | undefined) ??
    null;

  const mappedStatus = rawFirmaStatus ? mapFirmaStatus(rawFirmaStatus) : null;

  const statusPriority: Record<string, number> = {
    draft: 0, sent: 1, viewed: 2, completed: 3, declined: 3, expired: 3, failed: 3,
  };
  const currentDbStatus = sigRow.status as string;
  const currentPriority = statusPriority[currentDbStatus] ?? 0;
  const newPriority = mappedStatus ? (statusPriority[mappedStatus] ?? 0) : 0;
  const wouldUpdateTo = newPriority > currentPriority ? mappedStatus : currentDbStatus;

  trace.step7_statusMapping = {
    rawFirmaStatus,
    mappedStatus,
    currentDbStatus,
    currentPriority,
    newPriority,
    wouldUpdateStatus: wouldUpdateTo !== currentDbStatus,
    wouldUpdateTo,
    rawDocumentUrl,
    rawAuditTrailUrl,
    note: mappedStatus === null
      ? `⚠️ mapFirmaStatus("${rawFirmaStatus}") returned null — this status string is not handled`
      : newPriority <= currentPriority
        ? `ℹ️ No status upgrade: current="${currentDbStatus}" (priority ${currentPriority}) >= mapped="${mappedStatus}" (priority ${newPriority})`
        : `✅ Would advance: "${currentDbStatus}" → "${wouldUpdateTo}"`,
  };

  // ── 8. Webhook config ─────────────────────────────────────────────────────────
  trace.step8_webhookConfig = {
    FIRMA_WEBHOOK_SECRET_present: !!process.env.FIRMA_WEBHOOK_SECRET,
    FIRMA_WEBHOOK_SECRET_length: process.env.FIRMA_WEBHOOK_SECRET?.length ?? 0,
    timestampToleranceSeconds: 300,
    note: "Webhooks signed >5 min before delivery are rejected. Firma retries with the ORIGINAL timestamp so retries after 5 min always fail. sync-status polling is the reliable fallback.",
  };

  // ── 9. Summary ───────────────────────────────────────────────────────────────
  const issues: string[] = [];
  if (!process.env.FIRMA_API_KEY)             issues.push("FIRMA_API_KEY missing");
  if (!process.env.FIRMA_WEBHOOK_SECRET)      issues.push("FIRMA_WEBHOOK_SECRET missing");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) issues.push("SUPABASE_SERVICE_ROLE_KEY missing");
  if (!firmaRequestId)                        issues.push("firma_signing_request_id is null in proposal_signatures");
  if (firmaGetHttpStatus !== 200)             issues.push(`Firma GET /signing-requests returned HTTP ${firmaGetHttpStatus}`);
  if (!rawFirmaStatus)                        issues.push("Could not extract a status field from Firma response");
  if (mappedStatus === null && rawFirmaStatus) issues.push(`mapFirmaStatus("${rawFirmaStatus}") returned null — unhandled status string`);
  if (mappedStatus !== null && wouldUpdateTo === currentDbStatus && newPriority <= currentPriority)
    issues.push(`No status upgrade possible: DB="${currentDbStatus}" already at or above Firma="${rawFirmaStatus}"`);

  trace.summary = {
    issues: issues.length > 0 ? issues : ["No issues detected"],
    conclusion: issues.length === 0
      ? "All steps passed. If status is still stale in the UI, check the browser Network tab for sync-status errors."
      : `${issues.length} issue(s) found — see 'issues' array above`,
  };

  return NextResponse.json(trace, { status: 200 });
}

