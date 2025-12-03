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
      return NextResponse.json({ invoices: [], hasMore: false });
    }

    // Get pagination parameters from query string
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "10");
    const startingAfter = searchParams.get("starting_after");

    // Fetch invoices from Stripe
    const invoicesParams: any = {
      customer: profile.stripe_customer_id,
      limit: limit,
    };

    if (startingAfter) {
      invoicesParams.starting_after = startingAfter;
    }

    const invoices = await stripe.invoices.list(invoicesParams);

    // Format the response
    const formattedInvoices = invoices.data.map((inv: any) => ({
      id: inv.id,
      number: inv.number || null,
      created: inv.created,
      amount_paid: inv.amount_paid,
      currency: inv.currency,
      status: inv.status,
      hosted_invoice_url: inv.hosted_invoice_url || null,
      invoice_pdf: inv.invoice_pdf || null,
    }));

    return NextResponse.json({ 
      invoices: formattedInvoices,
      hasMore: invoices.has_more,
    });
  } catch (error: any) {
    console.error("Error fetching invoices:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch invoices" },
      { status: 500 }
    );
  }
}

