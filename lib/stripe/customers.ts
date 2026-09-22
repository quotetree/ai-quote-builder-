import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe/client";

function isMissingCustomerError(err: unknown): boolean {
  const e = err as {
    code?: string;
    message?: string;
    raw?: { code?: string; message?: string };
  };
  const code = e?.code || e?.raw?.code;
  const message = (e?.message || e?.raw?.message || "").toLowerCase();
  return (
    code === "resource_missing" ||
    message.includes("no such customer")
  );
}

/**
 * Resolve a Stripe customer ID that exists in the *current* Stripe mode
 * (test vs live). Profiles may still hold a test-mode cus_… after switching
 * to live keys — Stripe then fails with resource_missing.
 *
 * On mismatch: create a new customer in the current mode and update profiles.
 */
export async function resolveStripeCustomerId(params: {
  supabase: SupabaseClient;
  userId: string;
  email?: string | null;
  existingCustomerId?: string | null;
}): Promise<string> {
  const { supabase, userId, email } = params;
  let customerId = params.existingCustomerId || null;

  if (!customerId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .maybeSingle();
    customerId = profile?.stripe_customer_id || null;
  }

  if (customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (!("deleted" in customer && customer.deleted)) {
        return customer.id;
      }
      console.warn(
        `[stripe-customer] stored customer ${customerId} is deleted — creating a new one`
      );
    } catch (err) {
      if (isMissingCustomerError(err)) {
        console.warn(
          `[stripe-customer] stored customer ${customerId} missing in current Stripe mode — creating a new customer`
        );
      } else {
        throw err;
      }
    }
  }

  const customer = await stripe.customers.create({
    email: email || undefined,
    metadata: { supabase_user_id: userId },
  });

  const { error } = await supabase
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", userId);

  if (error) {
    console.error("[stripe-customer] failed to persist new customer id:", error);
  } else {
    console.log(`[stripe-customer] ✅ profile ${userId} → ${customer.id}`);
  }

  return customer.id;
}

/** True when err is Stripe saying the customer id doesn't exist in this mode. */
export function isStripeCustomerModeMismatch(err: unknown): boolean {
  return isMissingCustomerError(err);
}
