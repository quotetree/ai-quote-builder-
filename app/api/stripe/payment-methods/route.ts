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

    // Fetch payment methods from Stripe
    const paymentMethods = await stripe.paymentMethods.list({
      customer: profile.stripe_customer_id,
      type: "card",
    });

    // Format the response
    const formattedMethods = paymentMethods.data.map((pm: any) => ({
      id: pm.id,
      brand: pm.card?.brand || "unknown",
      last4: pm.card?.last4 || "0000",
      exp_month: pm.card?.exp_month || 0,
      exp_year: pm.card?.exp_year || 0,
    }));

    return NextResponse.json({ paymentMethods: formattedMethods });
  } catch (error: any) {
    console.error("Error fetching payment methods:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch payment methods" },
      { status: 500 }
    );
  }
}

