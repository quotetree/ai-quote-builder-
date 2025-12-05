// Stripe Price IDs Configuration
// Updated with actual Price IDs from Stripe Dashboard

export const STRIPE_PRICE_IDS = {
  individual: {
    monthly: process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY || "price_1SXAe1RiMM33f0now2b6gRYL", // $97/month
    yearly: process.env.STRIPE_PRICE_INDIVIDUAL_YEARLY || "price_1SXAfbRiMM33f0noCqAfASFd", // $79/month (billed yearly)
  },
  organization: {
    base: {
      monthly: process.env.STRIPE_PRICE_ORG_BASE_MONTHLY || "price_1Sale4RiMM33f0no5vlKWsly", // $158/month (2 licenses) - TEST MODE
      yearly: process.env.STRIPE_PRICE_ORG_BASE_YEARLY || "price_1SaldJRiMM33f0no1uvw4pNQ", // $130/month billed yearly (2 licenses) - TEST MODE
    },
    additionalLicense: {
      monthly: process.env.STRIPE_PRICE_LICENSE_MONTHLY || "price_1SXAh6RiMM33f0nolptn9oFm", // $79/month per license
      yearly: process.env.STRIPE_PRICE_LICENSE_YEARLY || "price_1SXAhXRiMM33f0noFvt6V6oX", // $65/month per license
    },
  },
} as const;

// Stripe configuration
export const STRIPE_CONFIG = {
  currency: "usd",
  successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
  cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
};

