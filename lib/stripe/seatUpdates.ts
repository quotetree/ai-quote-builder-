import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import {
  getProPriceId,
  inferSubscriptionFromStripeItems,
  planTypeFromSeatCount,
  proPriceFields,
} from "@/lib/stripe/pricing";
import type { BillingCycle } from "@/types/database";

export type SeatIncreaseResult =
  | {
      ok: true;
      subscription: Stripe.Subscription;
      targetSeatCount: number;
      previousSeatCount: number;
      invoiceId: string | null;
      paymentIntentStatus: string | null;
    }
  | {
      ok: false;
      reason: "payment_failed" | "requires_action" | "incomplete";
      message: string;
      previousSeatCount: number;
      targetSeatCount: number;
      pendingUpdate: boolean;
      clientSecret: string | null;
      paymentIntentStatus: string | null;
      invoiceId: string | null;
      invoiceStatus: string | null;
      subscription: Stripe.Subscription;
    };

function getPaymentIntent(invoice: Stripe.Invoice | string | null | undefined): Stripe.PaymentIntent | null {
  if (!invoice || typeof invoice === "string") return null;
  const pi = (invoice as Stripe.Invoice & { payment_intent?: string | Stripe.PaymentIntent | null })
    .payment_intent;
  if (!pi || typeof pi === "string") return null;
  return pi;
}

/**
 * Increase seats on an existing Pro subscription item.
 * Uses pending_if_incomplete + always_invoice so quantity applies only after payment succeeds.
 */
export async function increaseProSeatsWithImmediateInvoice(params: {
  stripeSubscriptionId: string;
  billingCycle: BillingCycle;
  previousSeatCount: number;
  targetSeatCount: number;
  metadata?: Record<string, string>;
}): Promise<SeatIncreaseResult> {
  const {
    stripeSubscriptionId,
    billingCycle,
    previousSeatCount,
    targetSeatCount,
    metadata = {},
  } = params;

  if (targetSeatCount <= previousSeatCount) {
    throw new Error("increaseProSeatsWithImmediateInvoice requires targetSeatCount > previousSeatCount");
  }

  const proPriceId = getProPriceId(billingCycle);
  const current = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ["items"],
  });
  const inferred = inferSubscriptionFromStripeItems(current.items.data);

  if (!inferred.isPro) {
    throw new Error("Subscription is not on the Pro price; cannot use Pro seat-increase path");
  }

  const proItem =
    current.items.data.find((item) => item.price.id === inferred.priceId) ||
    current.items.data.find((item) => item.price.id === proPriceId) ||
    current.items.data[0];

  if (!proItem) {
    throw new Error("No subscription item found to update");
  }

  // Absolute quantity on the existing item only — no duplicate plan items, no anchor reset.
  // Note: pending_if_incomplete only supports a limited attribute set (no metadata).
  // See: https://docs.stripe.com/billing/subscriptions/pending-updates
  const prorationDate = Math.floor(Date.now() / 1000);
  const updated = await stripe.subscriptions.update(stripeSubscriptionId, {
    items: [
      {
        id: proItem.id,
        quantity: targetSeatCount,
      },
    ],
    payment_behavior: "pending_if_incomplete",
    proration_behavior: "always_invoice",
    proration_date: prorationDate,
    expand: ["latest_invoice.payment_intent"],
  });

  const latestInvoice = updated.latest_invoice;
  const invoiceObj =
    latestInvoice && typeof latestInvoice !== "string" ? latestInvoice : null;
  const paymentIntent = getPaymentIntent(latestInvoice);
  const invoiceId = invoiceObj?.id ?? (typeof latestInvoice === "string" ? latestInvoice : null);
  const invoiceStatus = invoiceObj?.status ?? null;
  const paymentIntentStatus = paymentIntent?.status ?? null;

  const appliedQuantity = updated.items.data.find((i) => i.id === proItem.id)?.quantity ?? 0;
  const hasPendingUpdate = !!updated.pending_update;
  const quantityApplied = appliedQuantity >= targetSeatCount && !hasPendingUpdate;

  if (quantityApplied) {
    // Metadata is not allowed on pending_if_incomplete updates — write it after success
    let finalSub = updated;
    try {
      finalSub = await stripe.subscriptions.update(stripeSubscriptionId, {
        metadata: {
          ...current.metadata,
          ...metadata,
          seat_count: String(targetSeatCount),
          previous_seat_count: String(previousSeatCount),
          seat_change: "upgrade",
          product: "pro",
          plan_type: planTypeFromSeatCount(targetSeatCount),
          billing_cycle: billingCycle,
        },
      });
    } catch (metaErr) {
      console.warn("[seatUpdates] post-success metadata update failed:", metaErr);
    }

    return {
      ok: true,
      subscription: finalSub,
      targetSeatCount,
      previousSeatCount,
      invoiceId,
      paymentIntentStatus,
    };
  }

  // Payment did not complete — Stripe kept the old quantity (pending update semantics)
  const requiresAction =
    paymentIntentStatus === "requires_action" ||
    paymentIntentStatus === "requires_confirmation" ||
    paymentIntentStatus === "requires_payment_method";

  return {
    ok: false,
    reason: requiresAction ? "requires_action" : "payment_failed",
    message: requiresAction
      ? "Additional authentication is required to complete payment for the new license(s)."
      : "Payment for the prorated license increase failed. No additional seats were granted.",
    previousSeatCount,
    targetSeatCount,
    pendingUpdate: hasPendingUpdate,
    clientSecret: paymentIntent?.client_secret ?? null,
    paymentIntentStatus,
    invoiceId,
    invoiceStatus,
    subscription: updated,
  };
}

export function proSeatDbFields(billingCycle: BillingCycle, seatCount: number) {
  return {
    ...proPriceFields(billingCycle, seatCount),
    billing_cycle: billingCycle,
  };
}
