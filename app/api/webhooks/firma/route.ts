import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { verifyFirmaWebhookSignature } from "@/lib/firma";

// ─── Event body shape ─────────────────────────────────────────────────────────

interface FirmaEventRecipient {
  id?: string;
  email?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  designation?: string;
  signed_at?: string;
}

interface FirmaEventBody {
  id?: string;
  type?: string;
  event?: string;       // Firma sometimes puts the event type here too
  created_at?: string;
  data?: {
    signing_request?: {
      id?: string;
      status?: string;  // Firma may include status directly in the payload
      sent_at?: string;
      completed_at?: string;
      expires_at?: string;
      document_url?: string;
      signed_pdf_url?: string;
      audit_trail_url?: string;
    };
    recipients?: FirmaEventRecipient[];
    // Some Firma versions nest differently
    recipient?: FirmaEventRecipient;
  };
}

// ─── Webhook handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── 0. Env var presence check (boolean only — never log values) ──────────────
  console.log(
    "[firma/webhook] 🔧 Env vars present:" +
    `\n  FIRMA_API_KEY: ${!!process.env.FIRMA_API_KEY}` +
    `\n  FIRMA_WEBHOOK_SECRET: ${!!process.env.FIRMA_WEBHOOK_SECRET}` +
    `\n  PDFSHIFT_API_KEY: ${!!process.env.PDFSHIFT_API_KEY}` +
    `\n  SUPABASE_SERVICE_ROLE_KEY: ${!!process.env.SUPABASE_SERVICE_ROLE_KEY}` +
    `\n  NEXT_PUBLIC_SUPABASE_URL: ${!!process.env.NEXT_PUBLIC_SUPABASE_URL}` +
    `\n  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${!!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
  );

  const rawBody = await req.text();

  // ── 1. Read and log ALL Firma headers (diagnostic) ───────────────────────────
  const sigHeader    = req.headers.get("x-firma-signature");
  const sigHeaderOld = req.headers.get("x-firma-signature-old");
  const eventTypeHeader = req.headers.get("x-firma-event") ?? "";
  const deliveryId   = req.headers.get("x-firma-delivery") ?? "unknown";
  const contentType  = req.headers.get("content-type") ?? "";

  console.log(
    `[firma/webhook] 📬 Received | delivery: ${deliveryId}` +
    `\n  x-firma-event:    "${eventTypeHeader}"` +
    `\n  x-firma-signature present: ${!!sigHeader}` +
    `\n  x-firma-signature-old present: ${!!sigHeaderOld}` +
    `\n  content-type: ${contentType}` +
    `\n  body length: ${rawBody.length}` +
    `\n  body preview: ${rawBody.slice(0, 300)}`
  );

  // ── 2. Verify HMAC-SHA256 signature ─────────────────────────────────────────
  const webhookSecret = process.env.FIRMA_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[firma/webhook] ❌ FIRMA_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const primaryValid = verifyFirmaWebhookSignature(rawBody, sigHeader, webhookSecret);
  const fallbackValid = sigHeaderOld != null &&
    verifyFirmaWebhookSignature(rawBody, sigHeaderOld, webhookSecret);
  const isValid = primaryValid || fallbackValid;

  console.log(
    `[firma/webhook] 🔐 Signature check | primary: ${primaryValid} | fallback: ${fallbackValid} | pass: ${isValid}` +
    `\n  sigHeader: ${sigHeader?.slice(0, 60) ?? "(none)"}` +
    `\n  secret length: ${webhookSecret.length} | secret prefix: ${webhookSecret.slice(0, 8)}…`
  );

  if (!isValid) {
    console.warn(`[firma/webhook] ❌ Invalid signature | delivery: ${deliveryId}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── 3. Parse body ────────────────────────────────────────────────────────────
  let event: FirmaEventBody;
  try {
    event = JSON.parse(rawBody);
  } catch {
    console.error("[firma/webhook] ❌ Failed to parse JSON body | delivery:", deliveryId);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Firma may put the event type in the header, body.type, or body.event
  const eventType = eventTypeHeader || event.type || event.event || "";
  const signingRequestId = event.data?.signing_request?.id;

  console.log(
    `[firma/webhook] ✉️  Event: "${eventType}" | delivery: ${deliveryId}` +
    `\n  event_id: ${event.id ?? "n/a"}` +
    `\n  signing_request_id: ${signingRequestId ?? "(not found)"}` +
    `\n  data keys: ${Object.keys(event.data ?? {}).join(", ")}` +
    `\n  signing_request keys: ${Object.keys(event.data?.signing_request ?? {}).join(", ")}`
  );

  // ── 4. Require a signing_request ID ─────────────────────────────────────────
  if (!signingRequestId) {
    console.warn(
      `[firma/webhook] ⚠️  No signing_request.id in body | event: "${eventType}" | delivery: ${deliveryId}` +
      `\n  Full body: ${rawBody.slice(0, 500)}`
    );
    return NextResponse.json({ received: true });
  }

  // ── 5. Look up the matching proposal_signatures row ──────────────────────────
  const db = getServiceClient();

  const { data: row, error: lookupErr } = await db
    .from("proposal_signatures")
    .select("id, status, all_signers_data")
    .eq("firma_signing_request_id", signingRequestId)
    .maybeSingle();

  if (lookupErr) {
    console.error(
      `[firma/webhook] ❌ DB lookup failed | signing_request_id: ${signingRequestId}` +
      `\n  error: ${lookupErr.message} | code: ${lookupErr.code}`
    );
    return NextResponse.json({ error: "Database lookup failed" }, { status: 500 });
  }

  if (!row) {
    console.warn(
      `[firma/webhook] ⚠️  No proposal_signature row found | signing_request_id: ${signingRequestId}` +
      ` | event: "${eventType}"`
    );
    return NextResponse.json({ received: true });
  }

  console.log(
    `[firma/webhook] 🔍 Matched row ${row.id.slice(0, 8)} | current status: "${row.status}"`
  );

  // ── 6. Build update payload based on event type ──────────────────────────────
  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = { updated_at: now };

  switch (eventType) {

    // ── Sent ────────────────────────────────────────────────────────────────────
    case "signing_request.sent": {
      updatePayload.status  = "sent";
      updatePayload.sent_at = event.data?.signing_request?.sent_at ?? now;
      console.log(`[firma/webhook] 📤 → SENT | id: ${row.id.slice(0, 8)}`);
      break;
    }

    // ── Viewed ──────────────────────────────────────────────────────────────────
    case "signing_request.viewed": {
      // Advance to "viewed" only from earlier states
      if (row.status === "sent" || row.status === "draft") {
        updatePayload.status = "viewed";
        console.log(`[firma/webhook] 👁️  → VIEWED | id: ${row.id.slice(0, 8)}`);
      } else {
        // Status is already at "viewed" or later — still write updated_at so
        // the UI polling can confirm the row is active
        console.log(`[firma/webhook] ℹ️  VIEWED (already ${row.status}) — updating timestamp | id: ${row.id.slice(0, 8)}`);
      }
      break;
    }

    // ── Individual recipient signed ─────────────────────────────────────────────
    case "signing_request.recipient.signed": {
      // Firma may send the signing recipient in data.recipient (singular) or
      // data.recipients (array). Handle both.
      const eventRecipients: FirmaEventRecipient[] = [
        ...(Array.isArray(event.data?.recipients) ? event.data!.recipients! : []),
        ...(event.data?.recipient ? [event.data.recipient] : []),
      ];

      console.log(
        `[firma/webhook] ✍️  recipient.signed | recipients in payload: ${eventRecipients.length}` +
        ` | signed_at present: ${eventRecipients.filter(r => r.signed_at).map(r => r.email).join(", ")}`
      );

      const signedEmails = new Set(
        eventRecipients
          .filter((r) => r.signed_at)
          .map((r) => (r.email ?? "").toLowerCase())
      );

      const currentSigners: Array<Record<string, unknown>> =
        Array.isArray(row.all_signers_data) ? row.all_signers_data : [];

      const updatedSigners = currentSigners.map((s) => {
        const email = ((s.email as string) ?? "").toLowerCase();
        if (signedEmails.has(email)) {
          const match = eventRecipients.find(
            (r) => (r.email ?? "").toLowerCase() === email
          );
          return { ...s, signed_at: match?.signed_at ?? now };
        }
        return s;
      });

      const signedCount = updatedSigners.filter((s) => s.signed_at).length;
      updatePayload.all_signers_data = updatedSigners;
      // Advance status to "viewed" (at minimum) when someone has signed
      if (row.status === "sent" || row.status === "draft") {
        updatePayload.status = "viewed";
      }

      console.log(
        `[firma/webhook] ✍️  ${signedCount}/${updatedSigners.length} signers complete | id: ${row.id.slice(0, 8)}`
      );
      break;
    }

    // ── All recipients signed ────────────────────────────────────────────────────
    case "signing_request.completed": {
      updatePayload.status       = "completed";
      updatePayload.completed_at = event.data?.signing_request?.completed_at ?? now;

      const signingReq = event.data?.signing_request;
      const docUrl = signingReq?.document_url ?? signingReq?.signed_pdf_url ?? null;
      if (docUrl) {
        updatePayload.signed_pdf_url = docUrl;
        console.log(`[firma/webhook] 📄 signed_pdf_url captured`);
      } else {
        console.warn(`[firma/webhook] ⚠️  No signed PDF URL in completed event`);
      }
      if (signingReq?.audit_trail_url) {
        updatePayload.audit_trail_url = signingReq.audit_trail_url;
      }
      console.log(
        `[firma/webhook] ✅ → COMPLETED | id: ${row.id.slice(0, 8)}` +
        ` | completed_at: ${updatePayload.completed_at}` +
        ` | signed_pdf_url: ${docUrl ?? "(none)"}`
      );
      break;
    }

    // ── Declined / cancelled ─────────────────────────────────────────────────────
    case "signing_request.recipient.declined":
    case "signing_request.cancelled":
    case "signing_request.canceled": {
      updatePayload.status = "declined";
      const actor = event.data?.recipients?.[0]?.email ?? event.data?.recipient?.email ?? "unknown";
      console.log(`[firma/webhook] ❌ → DECLINED | id: ${row.id.slice(0, 8)} | by: ${actor}`);
      break;
    }

    // ── Expired ──────────────────────────────────────────────────────────────────
    case "signing_request.expired": {
      updatePayload.status = "expired";
      console.log(`[firma/webhook] ⏰ → EXPIRED | id: ${row.id.slice(0, 8)}`);
      break;
    }

    // ── Unknown — log full payload so we can add it ───────────────────────────────
    default: {
      console.warn(
        `[firma/webhook] ⚠️  UNHANDLED event type: "${eventType}" | delivery: ${deliveryId}` +
        `\n  Full body: ${rawBody.slice(0, 600)}`
      );
      return NextResponse.json({ received: true });
    }
  }

  // ── 7. Write update to Supabase ──────────────────────────────────────────────
  console.log(
    `[firma/webhook] 💾 Writing update | id: ${row.id.slice(0, 8)}` +
    ` | payload keys: ${Object.keys(updatePayload).join(", ")}`
  );

  const { error: updateErr } = await db
    .from("proposal_signatures")
    .update(updatePayload)
    .eq("id", row.id);

  if (updateErr) {
    console.error(
      `[firma/webhook] ❌ DB update failed | id: ${row.id.slice(0, 8)}` +
      `\n  error: ${updateErr.message} | code: ${updateErr.code}`
    );
    return NextResponse.json({ error: "Failed to update record" }, { status: 500 });
  }

  const newStatus = (updatePayload.status as string) ?? row.status;
  console.log(
    `[firma/webhook] ✅ Saved | id: ${row.id.slice(0, 8)} | "${row.status}" → "${newStatus}"`
  );

  return NextResponse.json({ received: true });
}
