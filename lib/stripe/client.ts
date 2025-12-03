import Stripe from "stripe";

// Initialize Stripe with the secret key
// Use a placeholder during build time, actual key required at runtime
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder", {
  apiVersion: "2025-11-17.clover",
  typescript: true,
});

