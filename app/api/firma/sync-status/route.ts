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
  getFirmaSigningRequestUsers,
} from "@/lib/firma";

const FIRMA_API_BASE = "https://api.firma.dev/functions/v1/signing-request-api";

// ─── Firma → internal status mapping ─────────────────────────────────────────

/**
 * Maps the raw status string returned by Firma's API to our internal status.
 * Firma may use different casing or wording across API versions.
 */
function mapFirmaStatus(raw: string): string | null {
  // Normalise: lowercase, collapse separators
  const s = raw.toLowerCase().replace(/[\s_\-]+/g, "_");
  if (["completed", "signed", "complete", "fully_signed", "all_signed",
       "executed", "done", "finished", "finalized"].includes(s)) return "completed";
  if (["declined", "rejected", "cancelled", "canceled", "refused",
       "voided", "void"].includes(s)) return "declined";
  if (["expired", "timed_out", "timeout"].includes(s)) return "expired";
  if (["sent", "pending", "in_progress", "active", "awaiting_signature",
       "awaiting", "waiting", "open", "processing"].includes(s)) return "sent";
  if (["viewed", "opened", "seen", "read"].includes(s)) return "viewed";
  return null;
}

/**
 * Searches common nesting patterns in a raw Firma response object to pull
 * a scalar string field (e.g. "status", "document_url").
 * Firma has varied its response shape across API versions; this tries all of them.
 */
function extractField(raw: Record<string, unknown>, key: string): string | null {
  if (typeof raw[key] === "string" && raw[key] !== "") return raw[key] as string;
  for (const wrapper of ["data", "signing_request", "result", "record", "signingRequest"]) {
    const nested = raw[wrapper];
    if (nested && typeof nested === "object") {
      const val = (nested as Record<string, unknown>)[key];
      if (typeof val === "string" && val !== "") return val;
    }
  }
  return null;
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
  const { data: proposal, error: proposalErr } = await supabase
    .from("quote_proposals")
    .select("id, organization_id")
    .eq("quote_id", quoteId)
    .maybeSingle();

  console.log(
    `[sync-status] step3 proposal lookup | quoteId: ${quoteId}` +
    ` | found: ${!!proposal} | proposalId: ${proposal?.id ?? "none"} | err: ${proposalErr?.message ?? "none"}`
  );

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

  console.log(
    `[sync-status] step4 sig lookup | proposalId: ${proposal.id}` +
    ` | found: ${!!sig} | status: ${sig?.status ?? "none"}` +
    ` | firma_id: ${(sig as Record<string, unknown> | null)?.firma_signing_request_id ?? "none"}` +
    ` | err: ${sigErr?.message ?? "none"}`
  );

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
    console.log(`[sync-status] step5 terminal status "${sig.status}" — returning cached row`);
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
    console.warn("[sync-status] step5 firma_signing_request_id is null — cannot poll Firma");
    return NextResponse.json({ status: sig.status });
  }

  // ── 6. Get Firma workspace key ───────────────────────────────────────────────
  let workspaceApiKey: string;
  try {
    workspaceApiKey = await getOrCreateFirmaWorkspace(proposal.organization_id);
    console.log(`[sync-status] step6 workspace key found | orgId: ${proposal.organization_id.slice(0, 8)}`);
  } catch (err) {
    console.warn("[sync-status] step6 Could not get Firma workspace key:", err);
    return NextResponse.json({ status: sig.status });
  }

  // ── 7. Call Firma — raw fetch, extract fields from any nesting depth ────────
  // We bypass the typed lib/firma.ts abstraction here so that an unexpected
  // response shape cannot silently prevent a status update.
  const firmaUrl = `${FIRMA_API_BASE}/signing-requests/${firmaRequestId}`;

  const doFirmaFetch = (apiKey: string) =>
    fetch(firmaUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });

  let firmaRes = await doFirmaFetch(workspaceApiKey);

  // Workspace key stale? Fall back to the master key and retry.
  if ((firmaRes.status === 401 || firmaRes.status === 403) && process.env.FIRMA_API_KEY) {
    const masterKey = process.env.FIRMA_API_KEY.trim();
    if (masterKey && masterKey !== workspaceApiKey) {
      console.warn(`[sync-status] step7 workspace key ${firmaRes.status} — retrying with master key`);
      firmaRes = await doFirmaFetch(masterKey);
    }
  }

  const firmaText = await firmaRes.text().catch(() => "");
  console.log(
    `[sync-status] step7 Firma GET ${firmaUrl}` +
    ` | HTTP ${firmaRes.status}` +
    ` | body: ${firmaText.slice(0, 600)}`
  );

  if (!firmaRes.ok) {
    console.warn(`[sync-status] step7 Firma returned ${firmaRes.status} — keeping current status`);
    return NextResponse.json({ status: sig.status });
  }

  let firmaRaw: Record<string, unknown> = {};
  try { firmaRaw = JSON.parse(firmaText) as Record<string, unknown>; } catch {
    console.warn("[sync-status] step7 Firma response is not JSON — keeping current status");
    return NextResponse.json({ status: sig.status });
  }

  // ── 8. Fetch per-recipient signed_at — try workspace key then master key ───────
  let firmaUsers: Array<Record<string, unknown>> = [];
  try {
    firmaUsers = (await getFirmaSigningRequestUsers(workspaceApiKey, firmaRequestId)) as unknown as Array<Record<string, unknown>>;
  } catch {
    // Workspace key may be stale — retry with master key
    if (process.env.FIRMA_API_KEY) {
      try {
        firmaUsers = (await getFirmaSigningRequestUsers(
          process.env.FIRMA_API_KEY.trim(), firmaRequestId
        )) as unknown as Array<Record<string, unknown>>;
      } catch {
        // Non-fatal — proceed without per-recipient signed_at
      }
    }
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

  // ── 10. Determine new status ──────────────────────────────────────────────────
  const rawFirmaStatus   = extractField(firmaRaw, "status");
  const newSignedPdfUrl  =
    extractField(firmaRaw, "document_url") ??
    extractField(firmaRaw, "signed_pdf_url") ??
    extractField(firmaRaw, "signed_document_url") ??
    (sigRow.signed_pdf_url as string | null) ??
    null;
  const newAuditTrailUrl =
    extractField(firmaRaw, "audit_trail_url") ??
    (sigRow.audit_trail_url as string | null) ??
    null;
  const rawCompletedAt   = extractField(firmaRaw, "completed_at");

  const statusPriority: Record<string, number> = {
    draft: 0, sent: 1, viewed: 2, completed: 3, declined: 3, expired: 3, failed: 3,
  };

  // Start from Firma's top-level status field
  const mapped = rawFirmaStatus ? mapFirmaStatus(rawFirmaStatus) : null;
  const currentPriority = statusPriority[sig.status] ?? 0;
  const mappedPriority  = mapped ? (statusPriority[mapped] ?? 0) : 0;
  let newStatus = mappedPriority > currentPriority ? mapped! : sig.status;

  // ── 10b. Infer status from per-signer signed_at ──────────────────────────────
  // Firma keeps its aggregate status as "pending"/"in_progress" until EVERY
  // signer completes — this means a partial signature never advances our status.
  // Instead, count signed_at values from the updated signers list and infer:
  //   all signed  → completed
  //   any signed  → at least viewed
  // This fires regardless of what the top-level Firma status field says.
  const signerCount  = updatedSigners.length;
  const signedCount  = updatedSigners.filter(s => s.signed_at).length;

  if (signerCount > 0 && signedCount === signerCount &&
      (statusPriority[newStatus] ?? 0) < statusPriority["completed"]) {
    newStatus = "completed";
  } else if (signedCount > 0 &&
             (statusPriority[newStatus] ?? 0) < statusPriority["viewed"]) {
    newStatus = "viewed";
  }

  // ── 12. Build DB update payload ───────────────────────────────────────────────
  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let hasChanges = false;

  if (newStatus !== sig.status) {
    updatePayload.status = newStatus;
    hasChanges = true;
  }
  if (newSignedPdfUrl && newSignedPdfUrl !== (sigRow.signed_pdf_url as string | null)) {
    updatePayload.signed_pdf_url = newSignedPdfUrl;
    hasChanges = true;
  }
  if (newAuditTrailUrl && newAuditTrailUrl !== (sigRow.audit_trail_url as string | null)) {
    updatePayload.audit_trail_url = newAuditTrailUrl;
    hasChanges = true;
  }
  if (newStatus === "completed" && rawCompletedAt) {
    updatePayload.completed_at = rawCompletedAt;
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
    }
  }

  // Single summary log — appears as the last line in Vercel's per-request view
  console.log(
    `[sync-status] ✅ done | proposal: ${proposal.id.slice(0, 8)}` +
    ` | firmaStatus: "${rawFirmaStatus ?? "null"}"` +
    ` | signers: ${signedCount}/${signerCount} signed` +
    ` | db: "${sig.status}" → "${newStatus}"` +
    ` | changed: ${hasChanges}` +
    ` | signedPdfUrl: ${newSignedPdfUrl ? "present" : "null"}` +
    (mapped === null && rawFirmaStatus ? ` ⚠️ unmapped status "${rawFirmaStatus}" — top-level keys: ${Object.keys(firmaRaw).join(", ")}` : "")
  );

  return NextResponse.json({
    status: (updatePayload.status as string | undefined) ?? sig.status,
    signed_pdf_url: (updatePayload.signed_pdf_url as string | undefined) ?? (sigRow.signed_pdf_url as string | null) ?? null,
    audit_trail_url: (updatePayload.audit_trail_url as string | undefined) ?? (sigRow.audit_trail_url as string | null) ?? null,
    all_signers_data: (updatePayload.all_signers_data as unknown[] | undefined) ?? (sigRow.all_signers_data as unknown[]) ?? [],
    changed: hasChanges,
  });
}
