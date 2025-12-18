// Stripe Price IDs Configuration
// Updated with actual Price IDs from Stripe Dashboard

export const STRIPE_PRICE_IDS = {
  individual: {
    monthly: process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY || "price_1SfiSvRiMM33f0noxjiKIwBb", // $65/month - LIVE MODE
    yearly: process.env.STRIPE_PRICE_INDIVIDUAL_YEARLY || "price_1SfiTaRiMM33f0noXzQFmNXm", // $65/month (billed yearly) - LIVE MODE
  },
  organization: {
    base: {
      monthly: process.env.STRIPE_PRICE_ORG_BASE_MONTHLY || "price_1SXAFhRiMM33f0noHER0kGb3", // $130/month (2 licenses) - LIVE MODE
      yearly: process.env.STRIPE_PRICE_ORG_BASE_YEARLY || "price_1SXAEoRiMM33f0noEdOz3isR", // $130/month billed yearly (2 licenses) - LIVE MODE
    },
    additionalLicense: {
      monthly: process.env.STRIPE_PRICE_LICENSE_MONTHLY || "price_1SXBGWRiMM33f0nosJZCK0nk", // $65/month per license - LIVE MODE
      yearly: process.env.STRIPE_PRICE_LICENSE_YEARLY || "price_1SXBGFRiMM33f0no4Gx2P3cx", // $65/month per license - LIVE MODE
    },
  },
} as const;

// Stripe configuration
export const STRIPE_CONFIG = {
  currency: "usd",
  successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
  cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
};

