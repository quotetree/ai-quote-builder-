// Stripe Price IDs Configuration
// After creating products in Stripe Dashboard, update these IDs

export const STRIPE_PRICE_IDS = {
  individual: {
    monthly: process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY || "price_xxx", // $97/month
    yearly: process.env.STRIPE_PRICE_INDIVIDUAL_YEARLY || "price_xxx", // $79/month (billed monthly)
  },
  organization: {
    base: {
      monthly: process.env.STRIPE_PRICE_ORG_BASE_MONTHLY || "price_xxx", // $245/month
      yearly: process.env.STRIPE_PRICE_ORG_BASE_YEARLY || "price_xxx", // $197/month
    },
    additionalLicense: {
      monthly: process.env.STRIPE_PRICE_LICENSE_MONTHLY || "price_xxx", // $79/month per license
      yearly: process.env.STRIPE_PRICE_LICENSE_YEARLY || "price_xxx", // $65/month per license
    },
  },
} as const;

// Stripe configuration
export const STRIPE_CONFIG = {
  currency: "usd",
  successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
  cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
};

