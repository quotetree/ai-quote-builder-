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
      // No Stripe customer yet - return null
      return NextResponse.json({ customer: null });
    }

    // Fetch customer details from Stripe
    const customer = await stripe.customers.retrieve(profile.stripe_customer_id) as any;

    if (customer.deleted) {
      return NextResponse.json({ customer: null });
    }

    // Format the response
    const billingInfo = {
      name: customer.name || null,
      email: customer.email || null,
      address: customer.address ? {
        line1: customer.address.line1 || null,
        line2: customer.address.line2 || null,
        city: customer.address.city || null,
        state: customer.address.state || null,
        postal_code: customer.address.postal_code || null,
        country: customer.address.country || null,
      } : null,
    };

    return NextResponse.json({ customer: billingInfo });
  } catch (error: any) {
    console.error("Error fetching customer details:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch customer details" },
      { status: 500 }
    );
  }
}

