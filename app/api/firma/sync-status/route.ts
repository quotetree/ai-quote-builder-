/**
 * POST /api/firma/sync-status
 *
 * Actively polls the Firma API to get the real-time signing request status
 * and syncs it to Supabase.  This is the primary status-refresh path —
 * webhooks are a secondary, best-effort mechanism.
 *
 * Called by the proposal builder every 20 s while the document is pending.
 * Also safe to call on every modal open to get an up-to-date snapshot.
 *
 * Body: { quoteId: string }
 *
 * Returns:
 *   { status, signed_pdf_url, audit_trail_url, all_signers_data, changed }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import {
  getOrCreateFirmaWorkspace,
  getFirmaSigningRequestById,
  getFirmaSigningRequestUsers,
  type FirmaSigningRequest,
} from "@/lib/firma";

// ─── Firma → internal status mapping ─────────────────────────────────────────

/**
 * Maps the raw status string returned by Firma's API to our internal status.
 * Firma may use different casing or wording across API versions.
 */
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

export async function POST(req: NextRequest) {
  // ── 0. Env var presence check (boolean only — never log values) ──────────────
  console.log(
    "[sync-status] 🔧 Env vars present:" +
    `\n  FIRMA_API_KEY: ${!!process.env.FIRMA_API_KEY}` +
    `\n  FIRMA_WEBHOOK_SECRET: ${!!process.env.FIRMA_WEBHOOK_SECRET}` +
    `\n  PDFSHIFT_API_KEY: ${!!process.env.PDFSHIFT_API_KEY}` +
    `\n  SUPABASE_SERVICE_ROLE_KEY: ${!!process.env.SUPABASE_SERVICE_ROLE_KEY}` +
    `\n  NEXT_PUBLIC_SUPABASE_URL: ${!!process.env.NEXT_PUBLIC_SUPABASE_URL}` +
    `\n  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${!!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
  );

  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Parse body ────────────────────────────────────────────────────────────
  let quoteId: string;
  try {
    const body = await req.json();
    quoteId = body.quoteId;
    if (!quoteId || typeof quoteId !== "string") {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── 3. Load proposal ─────────────────────────────────────────────────────────
  const { data: proposal } = await supabase
    .from("quote_proposals")
    .select("id, organization_id")
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (!proposal) {
    return NextResponse.json({ status: null });
  }

  // ── 4. Load signature record ─────────────────────────────────────────────────
  const db = getServiceClient();
  const { data: sig, error: sigErr } = await db
    .from("proposal_signatures")
    .select("id, status, firma_signing_request_id, all_signers_data, signed_pdf_url, audit_trail_url")
    .eq("proposal_id", proposal.id)
    .maybeSingle();

  if (sigErr) {
    console.error("[sync-status] DB lookup error:", sigErr.message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!sig) {
    return NextResponse.json({ status: null });
  }

  const sigRow = sig as Record<string, unknown>;

  // ── 5. Return immediately for terminal statuses ──────────────────────────────
  // No need to poll Firma once we've reached a final state.
  if (
    sig.status === "completed" ||
    sig.status === "declined" ||
    sig.status === "expired"
  ) {
    return NextResponse.json({
      status: sig.status,
      signed_pdf_url: sigRow.signed_pdf_url ?? null,
      audit_trail_url: sigRow.audit_trail_url ?? null,
      all_signers_data: sigRow.all_signers_data ?? [],
      changed: false,
    });
  }

  const firmaRequestId = sigRow.firma_signing_request_id as string | null;
  if (!firmaRequestId) {
    return NextResponse.json({ status: sig.status });
  }

  // ── 6. Get Firma workspace key ───────────────────────────────────────────────
  let workspaceApiKey: string;
  try {
    workspaceApiKey = await getOrCreateFirmaWorkspace(proposal.organization_id);
  } catch (err) {
    console.warn("[sync-status] Could not get Firma workspace key:", err);
    return NextResponse.json({ status: sig.status });
  }

  // ── 7. Poll Firma API for signing request status ─────────────────────────────
  let firmaReq: FirmaSigningRequest | null = null;
  try {
    firmaReq = await getFirmaSigningRequestById(workspaceApiKey, firmaRequestId);
    console.log("[sync-status] Firma signing request status:", firmaReq?.status ?? "(not found)");
  } catch (err) {
    console.warn("[sync-status] Firma API error:", err);
    // Don't fail — return current DB status so UI stays functional
    return NextResponse.json({ status: sig.status });
  }

  if (!firmaReq) {
    return NextResponse.json({ status: sig.status });
  }

  // ── 8. Also fetch per-recipient signed_at from Firma users endpoint ──────────
  // This lets us update all_signers_data with individual signed_at timestamps
  // even when the recipient.signed webhook didn't arrive.
  let firmaUsers: Array<Record<string, unknown>> = [];
  try {
    firmaUsers = (await getFirmaSigningRequestUsers(workspaceApiKey, firmaRequestId)) as unknown as Array<Record<string, unknown>>;
  } catch {
    // Non-fatal — proceed without per-recipient signed_at data
  }

  // ── 9. Merge per-recipient signed_at into all_signers_data ───────────────────
  const currentSigners: Array<Record<string, unknown>> =
    Array.isArray(sigRow.all_signers_data) ? sigRow.all_signers_data as Array<Record<string, unknown>> : [];

  let signersChanged = false;
  const updatedSigners = currentSigners.map((s) => {
    const email = ((s.email as string) ?? "").toLowerCase();
    const firmaUser = firmaUsers.find(
      (u) => ((u.email as string) ?? "").toLowerCase() === email
    );
    const signedAt = firmaUser?.signed_at as string | undefined;
    if (signedAt && !s.signed_at) {
      signersChanged = true;
      return { ...s, signed_at: signedAt };
    }
    return s;
  });

  // ── 10. Map Firma status → internal status ────────────────────────────────────
  const mapped = firmaReq.status ? mapFirmaStatus(firmaReq.status) : null;

  // Determine the new status — only advance, never downgrade
  const statusPriority: Record<string, number> = {
    draft: 0, sent: 1, viewed: 2, completed: 3, declined: 3, expired: 3, failed: 3,
  };
  const currentPriority = statusPriority[sig.status] ?? 0;
  const newPriority = mapped ? (statusPriority[mapped] ?? 0) : 0;
  const newStatus = newPriority > currentPriority ? mapped! : sig.status;

  // ── 11. Collect URL fields from Firma response ────────────────────────────────
  const rawReq = firmaReq as unknown as Record<string, unknown>;
  const newSignedPdfUrl =
    (rawReq.document_url as string | undefined) ??
    (rawReq.signed_pdf_url as string | undefined) ??
    (sigRow.signed_pdf_url as string | null) ??
    null;
  const newAuditTrailUrl =
    (rawReq.audit_trail_url as string | undefined) ??
    (sigRow.audit_trail_url as string | null) ??
    null;

  // ── 12. Build DB update payload ───────────────────────────────────────────────
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let hasChanges = false;

  if (newStatus !== sig.status) {
    updatePayload.status = newStatus;
    hasChanges = true;
    console.log(`[sync-status] Status change: ${sig.status} → ${newStatus}`);
  }
  if (newSignedPdfUrl && newSignedPdfUrl !== (sigRow.signed_pdf_url as string | null)) {
    updatePayload.signed_pdf_url = newSignedPdfUrl;
    hasChanges = true;
  }
  if (newAuditTrailUrl && newAuditTrailUrl !== (sigRow.audit_trail_url as string | null)) {
    updatePayload.audit_trail_url = newAuditTrailUrl;
    hasChanges = true;
  }
  if (newStatus === "completed" && firmaReq.completed_at) {
    updatePayload.completed_at = firmaReq.completed_at;
    hasChanges = true;
  }
  if (signersChanged) {
    updatePayload.all_signers_data = updatedSigners;
    hasChanges = true;
  }

  // ── 13. Persist if anything changed ──────────────────────────────────────────
  if (hasChanges) {
    const { error: updateErr } = await db
      .from("proposal_signatures")
      .update(updatePayload)
      .eq("id", sig.id);

    if (updateErr) {
      console.error("[sync-status] DB update failed:", updateErr.message);
    } else {
      console.log("[sync-status] DB updated successfully for proposal:", proposal.id.slice(0, 8));
    }
  }

  return NextResponse.json({
    status: (updatePayload.status as string | undefined) ?? sig.status,
    signed_pdf_url: (updatePayload.signed_pdf_url as string | undefined) ?? (sigRow.signed_pdf_url as string | null) ?? null,
    audit_trail_url: (updatePayload.audit_trail_url as string | undefined) ?? (sigRow.audit_trail_url as string | null) ?? null,
    all_signers_data: (updatePayload.all_signers_data as unknown[] | undefined) ?? (sigRow.all_signers_data as unknown[]) ?? [],
    changed: hasChanges,
  });
}
