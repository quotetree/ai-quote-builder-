"use client";

import { loadStripe } from "@stripe/stripe-js";
import type { BillingCycle, PlanType, ProrationPreview } from "@/types/database";
import { validateStripePublishableKey, isProduction } from "./env-guards";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

try {
  validateStripePublishableKey(publishableKey);
} catch (error) {
  console.error("❌ Stripe Publishable Key Validation Failed:", error);
  if (isProduction()) {
    throw error;
  }
}

loadStripe(publishableKey!);

export type CheckoutOptions = {
  billingCycle: BillingCycle;
  seatCount: number;
  forceCheckout?: boolean;
  trialPeriodDays?: number;
  customerEmail?: string;
};

/**
 * Fetch proration preview for seat / cycle changes.
 */
export async function fetchProrationPreview(
  billingCycle: BillingCycle,
  seatCount: number
): Promise<ProrationPreview>;
/** @deprecated */
export async function fetchProrationPreview(
  planType: PlanType,
  billingCycle: BillingCycle,
  additionalLicenses?: number
): Promise<ProrationPreview>;
export async function fetchProrationPreview(
  a: BillingCycle | PlanType,
  b: number | BillingCycle,
  c: number = 0
): Promise<ProrationPreview> {
  let billingCycle: BillingCycle;
  let seatCount: number;

  if (a === "monthly" || a === "yearly") {
    billingCycle = a;
    seatCount = typeof b === "number" ? b : 1;
  } else {
    billingCycle = (b === "monthly" || b === "yearly" ? b : "monthly") as BillingCycle;
    seatCount = a === "organization" ? 2 + c : 1;
  }

  const response = await fetch("/api/stripe/preview-proration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ billingCycle, seatCount }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to preview changes");
  }

  return await response.json();
}

/**
 * Create a Stripe Checkout session (Pro) or update subscription in place.
 */
export async function createCheckoutSession(options: CheckoutOptions): Promise<any>;
/** @deprecated positional legacy API */
export async function createCheckoutSession(
  planType: PlanType,
  billingCycle: BillingCycle,
  additionalLicenses?: number,
  forceCheckout?: boolean,
  trialPeriodDays?: number
): Promise<any>;
export async function createCheckoutSession(
  optionsOrPlan: CheckoutOptions | PlanType,
  billingCycle?: BillingCycle,
  additionalLicenses: number = 0,
  forceCheckout: boolean = false,
  trialPeriodDays?: number
) {
  let payload: CheckoutOptions;

  if (typeof optionsOrPlan === "object" && optionsOrPlan !== null && "billingCycle" in optionsOrPlan) {
    payload = optionsOrPlan;
  } else {
    const planType = optionsOrPlan as PlanType;
    const cycle = billingCycle || "monthly";
    payload = {
      billingCycle: cycle,
      seatCount: planType === "organization" ? 2 + additionalLicenses : 1,
      forceCheckout,
      trialPeriodDays,
    };
  }

  const response = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create checkout session");
  }

  const data = await response.json();

  if (data.updated) {
    return data;
  }

  if (data.url) {
    window.location.href = data.url;
    return null;
  }

  return data;
}

export async function cancelPendingPlanChange(): Promise<void> {
  const response = await fetch("/api/stripe/cancel-pending-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to cancel pending change");
  }
}

export async function openCustomerPortal() {
  const response = await fetch("/api/stripe/portal", { method: "POST" });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to open customer portal");
  }

  const { url } = await response.json();
  if (url) {
    window.location.href = url;
  }
}

/** Set absolute seat quantity on the current paid subscription. */
export async function updateSeats(targetSeatCount: number) {
  const response = await fetch("/api/stripe/add-licenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetSeatCount }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update seats");
  }

  return await response.json();
}

/** @deprecated Prefer updateSeats(absoluteCount) */
export async function addLicenses(additionalLicensesToAdd: number) {
  const response = await fetch("/api/stripe/add-licenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ additionalLicensesToAdd }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to add licenses");
  }

  return await response.json();
}

export async function fetchPaymentMethods() {
  const response = await fetch("/api/stripe/payment-methods");
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch payment methods");
  }
  const data = await response.json();
  return data.paymentMethods || [];
}

export async function fetchCustomerDetails() {
  const response = await fetch("/api/stripe/customer");
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch customer details");
  }
  const data = await response.json();
  return data.customer || null;
}

export async function fetchInvoices(limit: number = 10, startingAfter?: string) {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (startingAfter) params.append("starting_after", startingAfter);

  const response = await fetch(`/api/stripe/invoices?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch invoices");
  }

  const data = await response.json();
  return {
    invoices: data.invoices || [],
    hasMore: data.hasMore || false,
  };
}
