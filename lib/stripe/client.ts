import Stripe from "stripe";
import { validateStripeSecretKey } from "./env-guards";

// Validate the secret key before initializing Stripe
// This ensures we never accidentally use test keys in production
const secretKey = process.env.STRIPE_SECRET_KEY;
validateStripeSecretKey(secretKey);

// Initialize Stripe with the validated secret key
// No fallback allowed - key must be properly configured
if (!secretKey) {
  throw new Error("STRIPE_SECRET_KEY validation failed but no error was thrown");
}

export const stripe = new Stripe(secretKey, {
  apiVersion: "2025-11-17.clover",
  typescript: true,
});

