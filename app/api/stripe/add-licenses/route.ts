import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { STRIPE_PRICE_IDS } from "@/lib/stripe/config";
import type { BillingCycle } from "@/types/database";

export async function POST(request: NextRequest) {
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

    // Parse request body
    const body = await request.json();
    const { additionalLicensesToAdd } = body as {
      additionalLicensesToAdd: number;
    };

    if (!additionalLicensesToAdd || additionalLicensesToAdd < 1) {
      return NextResponse.json(
        { error: "Invalid number of licenses" },
        { status: 400 }
      );
    }

    // Get user's organization context
    const { data: orgData } = await supabase.rpc(
      "get_user_organization_membership",
      { p_user_id: user.id }
    );

    if (!orgData || orgData.length === 0) {
      return NextResponse.json({ error: "No organization found" }, { status: 404 });
    }

    const orgContext = orgData[0];

    // Check if user is owner
    if (orgContext.role !== "owner") {
      return NextResponse.json(
        { error: "Only the owner can manage licenses" },
        { status: 403 }
      );
    }

    // Get subscription
    const { data: subscription, error: subError } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("organization_id", orgContext.organization_id)
      .single();

    if (subError || !subscription) {
      return NextResponse.json({ error: "No subscription found" }, { status: 404 });
    }

    if (subscription.plan_type !== "organization") {
      return NextResponse.json(
        { error: "Only organization plans can add licenses" },
        { status: 400 }
      );
    }

    if (!subscription.stripe_subscription_id) {
      return NextResponse.json(
        { error: "No Stripe subscription found" },
        { status: 400 }
      );
    }

    // Get Stripe subscription
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripe_subscription_id
    );

    // Find the additional license item
    const billingCycle = subscription.billing_cycle as BillingCycle || "yearly";
    const licensePriceId =
      billingCycle === "monthly"
        ? STRIPE_PRICE_IDS.organization.additionalLicense.monthly
        : STRIPE_PRICE_IDS.organization.additionalLicense.yearly;

    const licenseItem = stripeSubscription.items.data.find(
      (item) => item.price.id === licensePriceId
    );

    try {
      console.log('Before update - Subscription items:', {
        subscriptionId: stripeSubscription.id,
        items: stripeSubscription.items.data.map(item => ({
          id: item.id,
          priceId: item.price.id,
          quantity: item.quantity
        }))
      });

      if (licenseItem) {
        // Update existing license item quantity
        const newQuantity =
          (licenseItem.quantity || 0) + additionalLicensesToAdd;

        await stripe.subscriptionItems.update(licenseItem.id, {
          quantity: newQuantity,
          proration_behavior: "create_prorations", // Charge prorated amount immediately
        });
        
        console.log('After update - License item:', {
          itemId: licenseItem.id,
          priceId: licensePriceId,
          oldQuantity: licenseItem.quantity,
          newQuantity: newQuantity
        });
      } else {
        // Add new license item to subscription
        const newItem = await stripe.subscriptionItems.create({
          subscription: stripeSubscription.id,
          price: licensePriceId,
          quantity: additionalLicensesToAdd,
          proration_behavior: "create_prorations",
        });
        
        console.log('Created new license item:', {
          itemId: newItem.id,
          priceId: licensePriceId,
          quantity: additionalLicensesToAdd
        });
      }
    } catch (stripeError: any) {
      console.error("Failed to update Stripe subscription:", stripeError);
      return NextResponse.json(
        { error: stripeError.message || "Failed to update subscription in Stripe" },
        { status: 500 }
      );
    }

    // The webhook will handle updating the database
    return NextResponse.json({
      success: true,
      message: `Added ${additionalLicensesToAdd} license(s) successfully`,
    });
  } catch (error: any) {
    console.error("Add licenses error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to add licenses" },
      { status: 500 }
    );
  }
}

