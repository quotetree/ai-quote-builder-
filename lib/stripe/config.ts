// Stripe Price IDs — Pro prices come from env only (no hardcoded live fallbacks).
// Legacy IDs are read-only for grandfathered webhook recognition.

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[stripe] Missing required env var: ${name}`);
  }
  return value;
}

/** Resolve the Pro Price ID for a billing cycle. Throws if env is missing. */
export function getProPriceId(billingCycle: "monthly" | "yearly"): string {
  return billingCycle === "monthly"
    ? requireEnv("STRIPE_PRO_MONTHLY_PRICE_ID")
    : requireEnv("STRIPE_PRO_ANNUAL_PRICE_ID");
}

/** Try to resolve Pro Price IDs without throwing (e.g. webhook matching). */
export function tryGetProPriceIds(): { monthly: string | null; yearly: string | null } {
  return {
    monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID?.trim() || null,
    yearly: process.env.STRIPE_PRO_ANNUAL_PRICE_ID?.trim() || null,
  };
}

/**
 * Legacy Stripe Price IDs — grandfathered customers only.
 * Never use these for new checkouts or new seat purchases.
 */
export const LEGACY_STRIPE_PRICE_IDS = {
  individual: {
    monthly: "price_1SfiSvRiMM33f0noxjiKIwBb",
    yearly: "price_1SfiTaRiMM33f0noXzQFmNXm",
  },
  organization: {
    base: {
      monthly: "price_1SXAFhRiMM33f0noHER0kGb3",
      yearly: "price_1SXAEoRiMM33f0noEdOz3isR",
    },
    additionalLicense: {
      monthly: "price_1SXBGWRiMM33f0nosJZCK0nk",
      yearly: "price_1SXBGFRiMM33f0no4Gx2P3cx",
    },
  },
} as const;

/** @deprecated Prefer getProPriceId / LEGACY_STRIPE_PRICE_IDS. Kept for gradual migration. */
export const STRIPE_PRICE_IDS = {
  individual: LEGACY_STRIPE_PRICE_IDS.individual,
  organization: LEGACY_STRIPE_PRICE_IDS.organization,
} as const;

export const STRIPE_CONFIG = {
  currency: "usd",
  successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
  cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
};

export const MAX_SEAT_COUNT = 100;
