"use client";

import { loadStripe } from "@stripe/stripe-js";
import type { PlanType, BillingCycle, ProrationPreview } from "@/types/database";
import { validateStripePublishableKey, isProduction } from "./env-guards";

// Validate the publishable key before initializing Stripe
// This ensures we never accidentally use test keys in production
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

// Perform validation
try {
  validateStripePublishableKey(publishableKey);
} catch (error) {
  // In client-side code, we can't throw during module initialization
  // Log the error clearly and let it fail at runtime
  console.error("❌ Stripe Publishable Key Validation Failed:", error);
  if (isProduction()) {
    // In production, this is a critical error
    throw error;
  }
}

// Initialize Stripe (client-side) with validated key
const stripePromise = loadStripe(publishableKey!);

/**
 * Fetch proration preview for a plan change
 * Shows user what they'll be charged or credited before confirming
 */
export async function fetchProrationPreview(
  newPlanType: PlanType,
  newBillingCycle: BillingCycle,
  additionalLicenses: number = 0
): Promise<ProrationPreview> {
  const response = await fetch("/api/stripe/preview-proration", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      planType: newPlanType,
      billingCycle: newBillingCycle,
      additionalLicenses,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to preview changes");
  }

  return await response.json();
}

/**
 * Create a Stripe Checkout session and redirect the user
 * Returns the result object if subscription was updated in-place
 */
export async function createCheckoutSession(
  planType: PlanType,
  billingCycle: BillingCycle,
  additionalLicenses: number = 0,
  forceCheckout: boolean = false,
  trialPeriodDays?: number
) {
  const response = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      planType,
      billingCycle,
      additionalLicenses,
      forceCheckout,
      trialPeriodDays,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create checkout session");
  }

  const data = await response.json();

  // Check if this was an in-place update (no redirect needed)
  if (data.updated) {
    return data; // Return the update result
  }

  // Otherwise redirect to Stripe Checkout
  if (data.url) {
    window.location.href = data.url;
    return null; // Redirecting
  }

  return data;
}

/**
 * Cancel a pending plan change (scheduled downgrade)
 */
export async function cancelPendingPlanChange(): Promise<void> {
  const response = await fetch("/api/stripe/cancel-pending-change", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to cancel pending change");
  }
}

/**
 * Open Stripe Customer Portal for managing billing
 */
export async function openCustomerPortal() {
  const response = await fetch("/api/stripe/portal", {
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to open customer portal");
  }

  const { url } = await response.json();

  // Open portal in new window or redirect
  if (url) {
    window.location.href = url;
  }
}

/**
 * Add additional licenses to organization plan
 */
export async function addLicenses(additionalLicensesToAdd: number) {
  const response = await fetch("/api/stripe/add-licenses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      additionalLicensesToAdd,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to add licenses");
  }

  return await response.json();
}

/**
 * Fetch payment methods for the current user
 */
export async function fetchPaymentMethods() {
  const response = await fetch("/api/stripe/payment-methods");

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch payment methods");
  }

  const data = await response.json();
  return data.paymentMethods || [];
}

/**
 * Fetch customer billing details
 */
export async function fetchCustomerDetails() {
  const response = await fetch("/api/stripe/customer");

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch customer details");
  }

  const data = await response.json();
  return data.customer || null;
}

/**
 * Fetch invoices for the current user
 */
export async function fetchInvoices(limit: number = 10, startingAfter?: string) {
  const params = new URLSearchParams({
    limit: limit.toString(),
  });
  
  if (startingAfter) {
    params.append("starting_after", startingAfter);
  }

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

