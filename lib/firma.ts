/**
 * lib/firma.ts
 *
 * Server-side Firma.dev API helpers.
 * All functions must only be called from API routes (never from client code).
 * The FIRMA_API_KEY is never logged or returned to the browser.
 */

import crypto from "crypto";
import { getServiceClient } from "@/lib/supabase/service";
import type { TemplatePage } from "@/components/proposal-template/proposalTemplateTypes";

// ─── Constants ────────────────────────────────────────────────────────────────

const FIRMA_API_BASE = "https://api.firma.dev/functions/v1/signing-request-api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FirmaRecipient {
  first_name: string;
  last_name: string;
  email: string;
  designation: "Signer" | "CC";
  order: number;
}

export interface FirmaSigningRequestUser {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  designation?: string;
  // Official signing URL fields — Firma may use any of these names
  signing_url?: string;
  signingUrl?: string;
  link?: string;
  url?: string;
}

export interface FirmaSigningRequest {
  id: string;
  name: string;
  status: string;
  created_at: string;
  sent_at?: string;
  completed_at?: string;
  document_url?: string;
  signed_pdf_url?: string;
  audit_trail_url?: string;
}

/**
 * Extended recipient record that may include a signed_at timestamp when
 * fetching users after signing has begun (present in both webhook payloads
 * and in GET /signing-requests/{id}/users responses).
 */
export interface FirmaSigningRequestRecipientExtended extends FirmaSigningRequestRecipient {
  signed_at?: string;
}

/** A recipient record as returned by Firma after a signing request is created. */
export interface FirmaSigningRequestRecipient {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  designation?: string;
  order?: number;
}

/** A single interactive field to be placed on a Firma signing request document. */
interface FirmaField {
  type: "signature" | "initials" | "date" | "checkbox" | "text";
  required: boolean;
  recipient_id: string;
  page_number: number;
  position: {
    /** Horizontal offset as a percentage of page width (0–100). */
    x: number;
    /** Vertical offset as a percentage of page height (0–100). */
    y: number;
    /** Field width as a percentage of page width (0–100). */
    width: number;
    /** Field height as a percentage of page height (0–100). */
    height: number;
  };
  date_signing_default?: boolean;
}

export interface SignerLink {
  email: string;
  name: string;
  firma_user_id: string;
  signing_url: string;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * Thrown when Firma's API response does not contain an official signing URL
 * for one or more recipients. Never construct a guessed URL — surface this
 * to the caller so the user sees an actionable message.
 *
 * `message`    — clean, user-facing sentence shown in the UI.
 * `diagnostic` — full technical detail for server logs only.
 */
export class FirmaNoSigningUrlError extends Error {
  readonly diagnostic: string;

  constructor(userMessage: string, diagnostic: string) {
    super(userMessage);
    this.name = "FirmaNoSigningUrlError";
    this.diagnostic = diagnostic;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts the official signing URL from a raw Firma user object.
 * Returns null — never a guessed URL — if Firma did not provide one.
 *
 * Checked fields in priority order: signing_url, signingUrl, link, url.
 */
function extractOfficialSigningUrl(raw: Record<string, unknown>): string | null {
  for (const field of ["signing_url", "signingUrl", "link", "url"] as const) {
    const val = raw[field];
    if (typeof val === "string" && val.startsWith("http")) {
      return val;
    }
  }
  return null;
}

// ─── Env helpers ──────────────────────────────────────────────────────────────

function getMasterApiKey(): string {
  const key = process.env.FIRMA_API_KEY;
  if (!key || key.trim() === "") {
    throw new Error("FIRMA_API_KEY is not configured. Add it to your .env.local file.");
  }
  return key.trim();
}

function getFirmaHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  } as const;
}

// ─── Workspace management ─────────────────────────────────────────────────────

/**
 * Returns the Firma workspace API key for the given organization.
 * If no workspace exists yet, creates one with Firma and caches it in Supabase.
 * Uses the service role client so the API key is never exposed to the browser.
 */
export async function getOrCreateFirmaWorkspace(
  organizationId: string,
  orgName?: string
): Promise<string> {
  const db = getServiceClient();

  // Check cache first
  const { data: existing } = await db
    .from("firma_workspaces")
    .select("firma_workspace_key")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (existing) {
    return existing.firma_workspace_key;
  }

  // Create a new workspace via Firma API
  const masterKey = getMasterApiKey();
  const workspaceName = orgName ?? `org-${organizationId.slice(0, 8)}`;

  const res = await fetch(`${FIRMA_API_BASE}/workspaces`, {
    method: "POST",
    headers: getFirmaHeaders(masterKey),
    body: JSON.stringify({ name: workspaceName }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Firma workspace creation failed (${res.status}): ${body}`);
  }

  const workspace = await res.json();
  const { id: firma_workspace_id, api_key: firma_workspace_key } = workspace;

  if (!firma_workspace_id || !firma_workspace_key) {
    throw new Error("Firma workspace creation returned unexpected shape: " + JSON.stringify(workspace));
  }

  // Cache it
  const { error: insertErr } = await db.from("firma_workspaces").insert({
    organization_id: organizationId,
    firma_workspace_id,
    firma_workspace_key,
  });

  if (insertErr) {
    console.error("[firma] Failed to cache workspace:", insertErr.message);
    // Non-fatal — return the key anyway
  }

  console.log("[firma] Created workspace for org:", organizationId.slice(0, 8));
  return firma_workspace_key;
}

// ─── Signing requests ─────────────────────────────────────────────────────────

/**
 * Creates a Firma signing request from a base64-encoded PDF.
 * Returns the signing request object including its ID.
 */
export async function createFirmaSigningRequest(
  workspaceApiKey: string,
  params: {
    name: string;
    pdfBase64: string;
    recipients: FirmaRecipient[];
  }
): Promise<FirmaSigningRequest> {
  const res = await fetch(`${FIRMA_API_BASE}/signing-requests`, {
    method: "POST",
    headers: getFirmaHeaders(workspaceApiKey),
    body: JSON.stringify({
      name: params.name,
      document: params.pdfBase64,
      recipients: params.recipients,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Firma signing request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  console.log("[firma] create signing-request raw response:", JSON.stringify(data).slice(0, 500));

  // Firma may return { id, name, ... } directly OR wrap it in { data: { ... } }
  if (data && typeof data === "object") {
    const record = (data as Record<string, unknown>);
    if (record.id) return record as unknown as FirmaSigningRequest;
    if (record.data && typeof record.data === "object" && (record.data as Record<string, unknown>).id) {
      return record.data as unknown as FirmaSigningRequest;
    }
  }
  throw new Error(`Firma signing request returned unexpected shape: ${JSON.stringify(data).slice(0, 300)}`);
}

/**
 * Sends a Firma signing request that is currently in draft status.
 * This transitions the request to "sent", delivers email invitations to
 * each recipient, and activates the per-recipient signing URLs.
 *
 * Must be called after createFirmaSigningRequest and before the signing
 * URLs are displayed or stored — URLs are only valid once the request is sent.
 */
export async function sendFirmaSigningRequest(
  workspaceApiKey: string,
  signingRequestId: string
): Promise<void> {
  const res = await fetch(
    `${FIRMA_API_BASE}/signing-requests/${signingRequestId}/send`,
    {
      method: "POST",
      headers: getFirmaHeaders(workspaceApiKey),
      body: JSON.stringify({}),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Firma send signing request failed (${res.status}): ${body}`);
  }

  const data = await res.json().catch(() => ({}));
  console.log("[firma] signing request sent:", signingRequestId, "| response:", JSON.stringify(data).slice(0, 200));
}

/**
 * Fetches a single signing request by ID to read its current status.
 * Used for active polling so the UI stays accurate even when webhooks
 * fail to deliver (local dev, misconfigured secret, network issues, etc.).
 *
 * Returns null if Firma returns a 404 or an unexpected shape.
 * Throws for other non-OK responses (500, auth errors, etc.).
 */
export async function getFirmaSigningRequestById(
  workspaceApiKey: string,
  signingRequestId: string
): Promise<FirmaSigningRequest | null> {
  const url = `${FIRMA_API_BASE}/signing-requests/${signingRequestId}`;

  const doFetch = async (apiKey: string) =>
    fetch(url, { headers: getFirmaHeaders(apiKey) });

  let res = await doFetch(workspaceApiKey);

  // If the workspace key is stale (401/403), fall back to the master API key.
  // The signing request lives in Firma regardless of which key we authenticate with.
  if ((res.status === 401 || res.status === 403) && process.env.FIRMA_API_KEY) {
    const masterKey = process.env.FIRMA_API_KEY.trim();
    if (masterKey && masterKey !== workspaceApiKey) {
      console.warn(
        `[firma] workspace key returned ${res.status} for signing-request ${signingRequestId} — retrying with master key`
      );
      res = await doFetch(masterKey);
    }
  }

  if (res.status === 404) return null;

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    // Don't throw — log and return null so callers can fall back gracefully
    console.error(`[firma] GET signing-request failed (${res.status}): ${text.slice(0, 400)}`);
    return null;
  }

  let data: unknown;
  try { data = JSON.parse(text); } catch {
    console.error("[firma] GET signing-request: response is not JSON:", text.slice(0, 200));
    return null;
  }

  console.log("[firma] GET signing-request full response:", JSON.stringify(data).slice(0, 800));

  // Search common nesting patterns — Firma has varied this across API versions
  const candidates: unknown[] = [data];
  if (data && typeof data === "object") {
    const r = data as Record<string, unknown>;
    for (const key of ["data", "signing_request", "result", "record", "signingRequest"]) {
      if (r[key] && typeof r[key] === "object") candidates.push(r[key]);
    }
    // Also unwrap arrays (list endpoints sometimes return a single-item array)
    if (Array.isArray(r.data) && r.data.length === 1) candidates.push(r.data[0]);
    if (Array.isArray(data) && (data as unknown[]).length >= 1) candidates.push((data as unknown[])[0]);
  }

  for (const c of candidates) {
    if (c && typeof c === "object") {
      const obj = c as Record<string, unknown>;
      if (typeof obj.id === "string" && obj.id.length > 0) {
        return obj as unknown as FirmaSigningRequest;
      }
    }
  }

  console.warn(
    `[firma] GET signing-request: could not find id field in response. ` +
    `Top-level keys: ${data && typeof data === "object" ? Object.keys(data as object).join(", ") : typeof data}`
  );
  return null;
}

/**
 * Retrieves the list of signing request users (one per recipient).
 * Logs the full sanitized response shape so the official URL field name
 * can be confirmed from server logs.
 */
export async function getFirmaSigningRequestUsers(
  workspaceApiKey: string,
  signingRequestId: string
): Promise<FirmaSigningRequestRecipient[]> {
  const res = await fetch(
    `${FIRMA_API_BASE}/signing-requests/${signingRequestId}/users`,
    { headers: getFirmaHeaders(workspaceApiKey) }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Firma get signing users failed (${res.status}): ${body}`);
  }

  const data = await res.json();

  // Log the full response so we can see exactly which field names Firma uses.
  // API keys and tokens are included here — this log should only appear in
  // server-side output (never sent to the browser).
  console.log("[firma][debug] signing-request users raw response:", JSON.stringify(data));

  // Firma may return a plain array OR wrap it in a key — handle both
  let users: FirmaSigningRequestRecipient[] | null = null;
  if (Array.isArray(data)) {
    users = data;
  } else {
    for (const key of ["users", "data", "signing_request_users", "results", "items"]) {
      if (Array.isArray((data as Record<string, unknown>)[key])) {
        users = (data as Record<string, unknown>)[key] as FirmaSigningRequestRecipient[];
        break;
      }
    }
  }

  if (!users) {
    throw new Error(
      `Firma returned unexpected shape for signing-request users: ${JSON.stringify(data).slice(0, 300)}`
    );
  }

  // Log per-user fields so we know which URL field is present
  for (const u of users) {
    const raw = u as unknown as Record<string, unknown>;
    const officialUrl = extractOfficialSigningUrl(raw);
    console.log(
      `[firma][debug] user id=${u.id ?? "(none)"} email=${u.email ?? "(none)"}` +
      ` | official signing URL = ${officialUrl ?? "(NONE — fallback pattern will be used)"}`
    );
  }

  return users;
}

// ─── Field placement ──────────────────────────────────────────────────────────

const FIRMA_FIELD_TYPES = new Set(["signature", "initial", "date", "checkbox"]);
const PAGE_WIDTH_PX = 816;
const PAGE_HEIGHT_PX = 1056;

function toFirmaFieldType(elType: string): FirmaField["type"] {
  switch (elType) {
    case "signature": return "signature";
    case "initial":   return "initials";
    case "date":      return "date";
    case "checkbox":  return "checkbox";
    default:          return "text";
  }
}

/**
 * Converts proposal canvas elements (signature, initial, date, checkbox) into
 * Firma field objects with percentage-based positioning.
 *
 * Assignment is EXPLICIT ONLY: every field must have its assigned recipient's
 * email stored in `element.variableName`. Fields without an email are skipped
 * (the route validates that none exist before calling this function).
 */
function buildFirmaFields(
  pages: TemplatePage[],
  firmaRecipients: FirmaSigningRequestRecipient[],
): FirmaField[] {
  const fields: FirmaField[] = [];

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const pageH = page.pageHeight ?? PAGE_HEIGHT_PX;
    const pageNumber = pageIdx + 1;

    for (const el of page.elements) {
      if (!FIRMA_FIELD_TYPES.has(el.type)) continue;

      // Skip fields that have already been filled by the sender — they are
      // burned into the PDF as static content and must not be sent to Firma
      // as interactive fields (which would prompt the recipient to re-fill them).
      if (el.content && el.content.length > 0) {
        console.log(`[firma] skipping executed field type=${el.type} on page ${pageNumber} (content already present)`);
        continue;
      }

      const assignedEmail = (el.variableName ?? "").trim().toLowerCase();
      if (!assignedEmail) {
        // Route validation ensures this never happens; guard just in case.
        console.warn(`[firma] page ${pageNumber} ${el.type} has no assigned recipient — skipped`);
        continue;
      }

      const firmaRecipient = firmaRecipients.find(
        (fr) => fr.email.toLowerCase() === assignedEmail
      );
      if (!firmaRecipient) {
        console.warn(`[firma] no Firma recipient for email "${assignedEmail}" on page ${pageNumber} — skipped`);
        continue;
      }

      const field: FirmaField = {
        type: toFirmaFieldType(el.type),
        required: true,
        recipient_id: firmaRecipient.id,
        page_number: pageNumber,
        position: {
          x:      parseFloat(((el.x / PAGE_WIDTH_PX) * 100).toFixed(2)),
          y:      parseFloat(((el.y / pageH)          * 100).toFixed(2)),
          width:  parseFloat(((el.w / PAGE_WIDTH_PX) * 100).toFixed(2)),
          height: parseFloat(((el.h / pageH)          * 100).toFixed(2)),
        },
        ...(el.type === "date" ? { date_signing_default: true } : {}),
      };

      fields.push(field);
      console.log(
        `[firma] field  type=${field.type}  page=${pageNumber}` +
        `  recipient=${assignedEmail}` +
        `  x=${field.position.x}%  y=${field.position.y}%` +
        `  w=${field.position.width}%  h=${field.position.height}%`
      );
    }
  }

  return fields;
}

/**
 * Adds interactive fields to a Firma signing request via PUT.
 * Must be called BEFORE sending — Firma makes the request immutable after send.
 */
async function addFieldsToSigningRequest(
  workspaceApiKey: string,
  signingRequestId: string,
  fields: FirmaField[]
): Promise<void> {
  if (fields.length === 0) {
    console.log("[firma] No interactive fields to add — skipping field placement");
    return;
  }

  const res = await fetch(
    `${FIRMA_API_BASE}/signing-requests/${signingRequestId}`,
    {
      method: "PUT",
      headers: getFirmaHeaders(workspaceApiKey),
      body: JSON.stringify({ fields }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Firma add fields failed (${res.status}): ${body}`);
  }

  const data = await res.json().catch(() => ({}));
  console.log(
    `[firma] ${fields.length} field(s) added to signing request ${signingRequestId}` +
    ` | response: ${JSON.stringify(data).slice(0, 200)}`
  );
}

/**
 * Creates a signing request, sends it to recipients, then builds per-signer links.
 *
 * Flow:
 *   1. POST /signing-requests  → creates a DRAFT
 *   2. POST /signing-requests/{id}/send  → transitions to SENT, emails recipients,
 *      and activates the per-recipient signing URLs
 *   3. GET  /signing-requests/{id}/users → fetches recipient IDs to build URLs
 *
 * Signing URL resolution (per Firma docs):
 *   Use `recipient.signing_url` if present in the API response;
 *   otherwise fall back to the documented pattern:
 *   https://app.firma.dev/signing/{signing_request_user_id}
 *
 * Throws FirmaNoSigningUrlError only if a user record has no `id` at all,
 * which would indicate a malformed API response.
 */
export async function createSigningRequestWithLinks(
  workspaceApiKey: string,
  params: {
    name: string;
    pdfBase64: string;
    recipients: FirmaRecipient[];
    /** Proposal pages — used to extract interactive field positions. */
    pages?: TemplatePage[];
  }
): Promise<{ signingRequest: FirmaSigningRequest; signerLinks: SignerLink[] }> {
  // Step 1 — create the signing request (status: draft)
  const signingRequest = await createFirmaSigningRequest(workspaceApiKey, params);

  // Step 2 — fetch the per-recipient user records BEFORE sending.
  // We need Firma's assigned recipient IDs to map fields to signers.
  // The users endpoint works on draft requests.
  const users = await getFirmaSigningRequestUsers(workspaceApiKey, signingRequest.id);

  // Step 3 — build and add interactive fields from proposal elements.
  // Must happen BEFORE /send — Firma makes the request immutable after sending.
  if (params.pages && params.pages.length > 0) {
    const fields = buildFirmaFields(params.pages, users);
    console.log(`[firma] placing ${fields.length} interactive field(s) on signing request ${signingRequest.id}`);
    await addFieldsToSigningRequest(workspaceApiKey, signingRequest.id, fields);
  } else {
    console.warn("[firma] No pages passed to createSigningRequestWithLinks — skipping field placement");
  }

  // Step 4 — send the signing request so the URLs become active.
  // This emails each recipient and transitions status from draft → sent.
  await sendFirmaSigningRequest(workspaceApiKey, signingRequest.id);

  const signerLinks: SignerLink[] = [];

  for (const user of users) {
    const raw = user as unknown as Record<string, unknown>;

    if (!user.id) {
      const safeShape = JSON.stringify(
        Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "id"))
      ).slice(0, 400);

      const diagnostic =
        `Firma returned a user object with no id for "${user.email ?? "(unknown)"}". ` +
        `Fields present: ${safeShape}`;

      console.error("[firma] Anomalous user object (no id):", diagnostic);

      throw new FirmaNoSigningUrlError(
        `Firma returned an incomplete recipient record for "${user.email ?? "(unknown)"}". ` +
        `Please try again or contact Firma support.`,
        diagnostic
      );
    }

    // Prefer an official URL field returned by Firma; fall back to the
    // documented URL pattern (https://app.firma.dev/signing/{user_id}).
    const officialUrl = extractOfficialSigningUrl(raw);
    const signing_url = officialUrl ?? `https://app.firma.dev/signing/${user.id}`;

    if (officialUrl) {
      console.log(`[firma] signing URL from API response for ${user.email}: ${officialUrl}`);
    } else {
      console.log(
        `[firma] no signing_url field in API response for ${user.email}` +
        ` — using documented fallback: ${signing_url}`
      );
    }

    const matchedRecipient = params.recipients.find(
      (r) => r.email.toLowerCase() === (user.email ?? "").toLowerCase()
    );
    const name = matchedRecipient
      ? `${matchedRecipient.first_name} ${matchedRecipient.last_name}`.trim()
      : (user.email ?? "");

    signerLinks.push({ email: user.email, name, firma_user_id: user.id, signing_url });
  }

  return { signingRequest, signerLinks };
}

// ─── Webhook verification ─────────────────────────────────────────────────────

/**
 * Verifies a Firma webhook signature using HMAC-SHA256.
 *
 * Header format:  X-Firma-Signature: t={timestamp},v1={hex_digest}
 * Signed payload: "{timestamp}.{raw_json_body}"
 *
 * Returns true only when the signature is valid and the timestamp is within
 * the 5-minute replay-attack tolerance window.
 */
export function verifyFirmaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;

  const parts: Record<string, string> = {};
  for (const part of signatureHeader.split(",")) {
    const [k, v] = part.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  }

  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  // Accept webhooks up to 1 hour old to handle Firma's retry schedule.
  // Firma re-uses the original HMAC timestamp on retries, so the 5-minute
  // window used to silently drop every delivery attempt after the first.
  const ageSeconds = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (!Number.isFinite(ageSeconds) || ageSeconds > 3600) {
    console.warn("[firma webhook] Timestamp too old or invalid:", ageSeconds, "s");
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ─── Status helpers ───────────────────────────────────────────────────────────

export type ProposalSignatureStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "completed"
  | "declined"
  | "expired"
  | "failed";

/** Maps Firma webhook event types to our internal status labels. */
export function firmaEventToStatus(eventType: string): ProposalSignatureStatus | null {
  switch (eventType) {
    case "signing_request.sent":      return "sent";
    case "signing_request.viewed":    return "viewed";
    case "signing_request.completed": return "completed";
    case "signing_request.recipient.declined":
    case "signing_request.cancelled": return "declined";
    case "signing_request.expired":   return "expired";
    default:                           return null;
  }
}
