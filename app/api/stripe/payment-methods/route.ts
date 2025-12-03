import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";

export async function GET(request: NextRequest) {
  try {
    // Runtime check for Stripe key
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const supabase = await createClient();
    
    // Get the authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's Stripe customer ID
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (profileError) {
      return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
    }

    if (!profile?.stripe_customer_id) {
      // No Stripe customer yet - return empty array
      return NextResponse.json({ paymentMethods: [] });
    }

    // Fetch customer to get default payment method
    const customer = await stripe.customers.retrieve(profile.stripe_customer_id) as any;

    if (customer.deleted) {
      return NextResponse.json({ paymentMethods: [] });
    }

    // Get the default payment method ID
    const defaultPaymentMethodId = customer.invoice_settings?.default_payment_method;

    if (defaultPaymentMethodId) {
      // Fetch the default payment method
      const paymentMethod = await stripe.paymentMethods.retrieve(defaultPaymentMethodId) as any;
      
      const formattedMethod = {
        id: paymentMethod.id,
        brand: paymentMethod.card?.brand || "unknown",
        last4: paymentMethod.card?.last4 || "0000",
        exp_month: paymentMethod.card?.exp_month || 0,
        exp_year: paymentMethod.card?.exp_year || 0,
      };

      return NextResponse.json({ paymentMethods: [formattedMethod] });
    }

    // If no default, get the most recently added payment method
    const paymentMethods = await stripe.paymentMethods.list({
      customer: profile.stripe_customer_id,
      type: "card",
      limit: 1, // Only get the most recent one
    });

    if (paymentMethods.data.length === 0) {
      return NextResponse.json({ paymentMethods: [] });
    }

    // Format the most recent payment method
    const pm = paymentMethods.data[0] as any;
    const formattedMethod = {
      id: pm.id,
      brand: pm.card?.brand || "unknown",
      last4: pm.card?.last4 || "0000",
      exp_month: pm.card?.exp_month || 0,
      exp_year: pm.card?.exp_year || 0,
    };

    return NextResponse.json({ paymentMethods: [formattedMethod] });
  } catch (error: any) {
    console.error("Error fetching payment methods:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch payment methods" },
      { status: 500 }
    );
  }
}

