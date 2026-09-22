import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import {
  isStripeCustomerModeMismatch,
  resolveStripeCustomerId,
} from "@/lib/stripe/customers";

export async function GET(request: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (profileError) {
      return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
    }

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ paymentMethods: [] });
    }

    const customerId = profile.stripe_customer_id;

    try {
      const customer = (await stripe.customers.retrieve(customerId)) as any;

      if (customer.deleted) {
        return NextResponse.json({ paymentMethods: [] });
      }

      const defaultPaymentMethodId = customer.invoice_settings?.default_payment_method;

      if (defaultPaymentMethodId) {
        const paymentMethod = (await stripe.paymentMethods.retrieve(
          defaultPaymentMethodId
        )) as any;

        return NextResponse.json({
          paymentMethods: [
            {
              id: paymentMethod.id,
              brand: paymentMethod.card?.brand || "unknown",
              last4: paymentMethod.card?.last4 || "0000",
              exp_month: paymentMethod.card?.exp_month || 0,
              exp_year: paymentMethod.card?.exp_year || 0,
            },
          ],
        });
      }

      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
        limit: 1,
      });

      if (paymentMethods.data.length === 0) {
        return NextResponse.json({ paymentMethods: [] });
      }

      const pm = paymentMethods.data[0] as any;
      return NextResponse.json({
        paymentMethods: [
          {
            id: pm.id,
            brand: pm.card?.brand || "unknown",
            last4: pm.card?.last4 || "0000",
            exp_month: pm.card?.exp_month || 0,
            exp_year: pm.card?.exp_year || 0,
          },
        ],
      });
    } catch (err) {
      if (isStripeCustomerModeMismatch(err)) {
        await resolveStripeCustomerId({
          supabase,
          userId: user.id,
          email: user.email,
          existingCustomerId: customerId,
        });
        return NextResponse.json({ paymentMethods: [] });
      }
      throw err;
    }
  } catch (error: any) {
    console.error("Error fetching payment methods:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch payment methods" },
      { status: 500 }
    );
  }
}
