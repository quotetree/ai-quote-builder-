"use client";

import { loadStripe } from "@stripe/stripe-js";
import type { PlanType, BillingCycle } from "@/types/database";

// Initialize Stripe (client-side)
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

/**
 * Create a Stripe Checkout session and redirect the user
 */
export async function createCheckoutSession(
  planType: PlanType,
  billingCycle: BillingCycle,
  additionalLicenses: number = 0
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
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create checkout session");
  }

  const { url } = await response.json();

  // Redirect to Stripe Checkout
  if (url) {
    window.location.href = url;
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

