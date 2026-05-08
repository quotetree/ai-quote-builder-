/**
 * GET /api/firma/diagnose?quoteId=<uuid>
 *
 * Hard diagnostic trace for the Firma signing flow.
 * Runs the exact same steps as sync-status but returns every raw API
 * response, every DB value, and every mapping decision so failures are
 * visible without requiring access to Vercel function logs.
 *
 * Requires an authenticated session (same auth gate as sync-status).
 * Never logs or returns secret key values — only boolean presence and
 * non-secret identifiers.
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
  const quoteId = searchParams.get("quoteId");

  const trace: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    quoteId: quoteId ?? null,
    envVars: {
      FIRMA_API_KEY:              !!process.env.FIRMA_API_KEY,
      FIRMA_WEBHOOK_SECRET:       !!process.env.FIRMA_WEBHOOK_SECRET,
      PDFSHIFT_API_KEY:           !!process.env.PDFSHIFT_API_KEY,
      SUPABASE_SERVICE_ROLE_KEY:  !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL:   !!process.env.NEXT_PUBLIC_SUPABASE_URL,
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

  if (!quoteId) {
    return NextResponse.json({ error: "quoteId query param required", trace }, { status: 400 });
  }

  // ── 2. Look up quote_proposals (session/anon client — RLS applies) ───────────
  const { data: proposal, error: proposalErr } = await supabase
    .from("quote_proposals")
    .select("id, organization_id")
    .eq("quote_id", quoteId)
    .maybeSingle();

  trace.step2_proposalLookup = {
    client: "anon/session (RLS applies)",
    found: !!proposal,
    error: proposalErr?.message ?? null,
    proposalId: proposal?.id ?? null,
    organizationId: proposal?.organization_id ?? null,
  };

  if (proposalErr || !proposal) {
    return NextResponse.json({ error: "Proposal lookup failed or not found", trace });
  }

  // ── 3. Look up proposal_signatures (service-role — bypasses RLS) ─────────────
  const db = getServiceClient();
  const { data: sig, error: sigErr } = await db
    .from("proposal_signatures")
    .select(
      "id, status, firma_signing_request_id, firma_signing_request_user_id, " +
      "signing_url, signed_pdf_url, audit_trail_url, all_signers_data, " +
      "sent_at, completed_at, updated_at"
    )
    .eq("proposal_id", proposal.id)
    .maybeSingle();

  trace.step3_signatureLookup = {
    client: "service-role (bypasses RLS)",
    found: !!sig,
    error: sigErr?.message ?? null,
    sigId:                        sig?.id ?? null,
    status:                       sig?.status ?? null,
    firma_signing_request_id:     (sig as Record<string, unknown> | null)?.firma_signing_request_id ?? null,
    firma_signing_request_user_id:(sig as Record<string, unknown> | null)?.firma_signing_request_user_id ?? null,
    signed_pdf_url:               (sig as Record<string, unknown> | null)?.signed_pdf_url ?? null,
    audit_trail_url:              (sig as Record<string, unknown> | null)?.audit_trail_url ?? null,
    all_signers_data:             (sig as Record<string, unknown> | null)?.all_signers_data ?? null,
    sent_at:                      (sig as Record<string, unknown> | null)?.sent_at ?? null,
    completed_at:                 (sig as Record<string, unknown> | null)?.completed_at ?? null,
    updated_at:                   (sig as Record<string, unknown> | null)?.updated_at ?? null,
  };

  if (sigErr || !sig) {
    return NextResponse.json({ error: "Signature row not found", trace });
  }

  const firmaRequestId = (sig as Record<string, unknown>).firma_signing_request_id as string | null;
  if (!firmaRequestId) {
    return NextResponse.json({ error: "firma_signing_request_id is null in DB", trace });
  }

  // ── 4. Get Firma workspace key ───────────────────────────────────────────────
  let workspaceApiKey: string | null = null;
  try {
    workspaceApiKey = await getOrCreateFirmaWorkspace(proposal.organization_id);
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

  // ── 5. Call Firma GET /signing-requests/{id} — full raw response ─────────────
  let firmaGetHttpStatus: number | null = null;
  let firmaGetRawBody: unknown = null;
  try {
    const res = await fetch(
      `${FIRMA_API_BASE}/signing-requests/${firmaRequestId}`,
      {
        headers: {
          Authorization: `Bearer ${workspaceApiKey}`,
          "Content-Type": "application/json",
        },
      }
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
    trace.step5_firmaGetSigningRequest = {
      httpStatus: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // ── 6. Call Firma GET /signing-requests/{id}/users — full raw response ────────
  let firmaUsersHttpStatus: number | null = null;
  let firmaUsersRawBody: unknown = null;
  try {
    const res = await fetch(
      `${FIRMA_API_BASE}/signing-requests/${firmaRequestId}/users`,
      {
        headers: {
          Authorization: `Bearer ${workspaceApiKey}`,
          "Content-Type": "application/json",
        },
      }
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
    trace.step6_firmaGetUsers = {
      httpStatus: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // ── 7. Status mapping trace ───────────────────────────────────────────────────
  // Extract status from the raw Firma response — handles both flat and wrapped shapes.
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
  const currentPriority = statusPriority[sig.status as string] ?? 0;
  const newPriority = mappedStatus ? (statusPriority[mappedStatus] ?? 0) : 0;
  const wouldUpdateTo = newPriority > currentPriority ? mappedStatus : sig.status;

  trace.step7_statusMapping = {
    rawFirmaStatus,
    mappedStatus,
    currentDbStatus: sig.status,
    currentPriority,
    newPriority,
    wouldUpdateStatus: wouldUpdateTo !== sig.status,
    wouldUpdateTo,
    rawDocumentUrl,
    rawAuditTrailUrl,
    note: mappedStatus === null
      ? `⚠️ mapFirmaStatus("${rawFirmaStatus}") returned null — this status string is not handled`
      : newPriority <= currentPriority
        ? `ℹ️ No status upgrade: current="${sig.status}" (priority ${currentPriority}) >= mapped="${mappedStatus}" (priority ${newPriority})`
        : `✅ Would advance: "${sig.status}" → "${wouldUpdateTo}"`,
  };

  // ── 8. Webhook timestamp tolerance check ─────────────────────────────────────
  trace.step8_webhookConfig = {
    FIRMA_WEBHOOK_SECRET_present: !!process.env.FIRMA_WEBHOOK_SECRET,
    FIRMA_WEBHOOK_SECRET_length: process.env.FIRMA_WEBHOOK_SECRET?.length ?? 0,
    timestampToleranceSeconds: 300,
    note: "Webhooks signed >5 min before delivery are rejected by verifyFirmaWebhookSignature. " +
          "Firma retries with the ORIGINAL timestamp, so retries after 5 min will always fail. " +
          "sync-status polling is the reliable fallback.",
  };

  // ── 9. Summary ───────────────────────────────────────────────────────────────
  const issues: string[] = [];

  if (!process.env.FIRMA_API_KEY)         issues.push("FIRMA_API_KEY missing");
  if (!process.env.FIRMA_WEBHOOK_SECRET)  issues.push("FIRMA_WEBHOOK_SECRET missing");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) issues.push("SUPABASE_SERVICE_ROLE_KEY missing");
  if (!firmaRequestId)                    issues.push("firma_signing_request_id is null in proposal_signatures");
  if (firmaGetHttpStatus !== 200)         issues.push(`Firma GET /signing-requests returned HTTP ${firmaGetHttpStatus}`);
  if (!rawFirmaStatus)                    issues.push("Could not extract status field from Firma response");
  if (mappedStatus === null)              issues.push(`mapFirmaStatus("${rawFirmaStatus}") returned null — unhandled status string`);
  if (mappedStatus === sig.status)        issues.push(`Status already matches DB ("${sig.status}") — no update needed`);

  trace.summary = {
    issues: issues.length > 0 ? issues : ["No issues detected in this trace"],
    conclusion: issues.length === 0
      ? "All steps passed. If status is still stale in the UI, check the browser console for sync-status network errors."
      : `${issues.length} issue(s) found — see 'issues' array above`,
  };

  return NextResponse.json(trace, { status: 200 });
}
