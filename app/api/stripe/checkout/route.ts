import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { STRIPE_PRICE_IDS, STRIPE_CONFIG } from "@/lib/stripe/config";
import type { PlanType, BillingCycle } from "@/types/database";
import Stripe from "stripe";

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
    const { planType, billingCycle, additionalLicenses = 0 } = body as {
      planType: PlanType;
      billingCycle: BillingCycle;
      additionalLicenses?: number;
    };

    if (!planType || !billingCycle) {
      return NextResponse.json(
        { error: "Missing required fields: planType, billingCycle" },
        { status: 400 }
      );
    }

    if (planType === "free") {
      return NextResponse.json(
        { error: "Cannot create checkout for free plan" },
        { status: 400 }
      );
    }

    // Get or create Stripe customer
    let customerId: string;

    // Check if user already has a Stripe customer ID in the database
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (profile?.stripe_customer_id) {
      customerId = profile.stripe_customer_id;
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;

      // Save customer ID to profile
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // Get organization ID for metadata
    const { data: orgData } = await supabase.rpc(
      "get_user_organization_membership",
      { p_user_id: user.id }
    );

    const organizationId = orgData?.[0]?.organization_id;

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Check if organization already has an active subscription
    const { data: existingSubscription } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id, plan_type, billing_cycle")
      .eq("organization_id", organizationId)
      .single();

    // If active subscription exists, update it instead of creating new one
    if (existingSubscription?.stripe_subscription_id) {
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(
          existingSubscription.stripe_subscription_id
        ) as any;

        // Build new subscription items
        const items: any[] = [];

        if (planType === "individual") {
          const priceId =
            billingCycle === "monthly"
              ? STRIPE_PRICE_IDS.individual.monthly
              : STRIPE_PRICE_IDS.individual.yearly;

          items.push({
            price: priceId,
            quantity: 1,
          });
        } else if (planType === "organization") {
          const basePriceId =
            billingCycle === "monthly"
              ? STRIPE_PRICE_IDS.organization.base.monthly
              : STRIPE_PRICE_IDS.organization.base.yearly;

          items.push({
            price: basePriceId,
            quantity: 1,
          });

          if (additionalLicenses > 0) {
            const licensePriceId =
              billingCycle === "monthly"
                ? STRIPE_PRICE_IDS.organization.additionalLicense.monthly
                : STRIPE_PRICE_IDS.organization.additionalLicense.yearly;

            items.push({
              price: licensePriceId,
              quantity: additionalLicenses,
            });
          }
        }

        // Update the existing subscription
        const updatedSubscription = await stripe.subscriptions.update(
          existingSubscription.stripe_subscription_id,
          {
            items: items,
            proration_behavior: "always_invoice",
            metadata: {
              user_id: user.id,
              organization_id: organizationId,
              plan_type: planType,
              billing_cycle: billingCycle,
            },
          }
        );

        // Update subscription in database
        await supabase
          .from("subscriptions")
          .update({
            plan_type: planType,
            billing_cycle: billingCycle,
            additional_licenses: additionalLicenses,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", organizationId);

        return NextResponse.json({ 
          updated: true,
          subscriptionId: updatedSubscription.id,
          message: "Subscription updated successfully"
        });
      } catch (updateError: any) {
        console.error("Failed to update subscription:", updateError);
        // If update fails, fall through to create new checkout session
      }
    }

    // No active subscription - create new checkout session
    // Build line items based on plan type
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    if (planType === "individual") {
      const priceId =
        billingCycle === "monthly"
          ? STRIPE_PRICE_IDS.individual.monthly
          : STRIPE_PRICE_IDS.individual.yearly;

      lineItems.push({
        price: priceId,
        quantity: 1,
      });
    } else if (planType === "organization") {
      // Add base organization plan
      const basePriceId =
        billingCycle === "monthly"
          ? STRIPE_PRICE_IDS.organization.base.monthly
          : STRIPE_PRICE_IDS.organization.base.yearly;

      lineItems.push({
        price: basePriceId,
        quantity: 1,
      });

      // Add additional licenses if any
      if (additionalLicenses > 0) {
        const licensePriceId =
          billingCycle === "monthly"
            ? STRIPE_PRICE_IDS.organization.additionalLicense.monthly
            : STRIPE_PRICE_IDS.organization.additionalLicense.yearly;

        lineItems.push({
          price: licensePriceId,
          quantity: additionalLicenses,
        });
      }
    }

    // Build success URL - hard-coded for now since env var isn't loading
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3003";
    const successUrl = `${baseUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}&plan=${planType}`;
    const cancelUrl = `${baseUrl}/dashboard`;

    console.log("Creating Stripe Checkout with success_url:", successUrl);
    console.log("Base URL from env:", process.env.NEXT_PUBLIC_APP_URL);

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      payment_method_types: ["card"],
      consent_collection: {
        terms_of_service: "none",
      },
      metadata: {
        user_id: user.id,
        organization_id: organizationId || "",
        plan_type: planType,
        billing_cycle: billingCycle,
        additional_licenses: additionalLicenses.toString(),
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          organization_id: organizationId || "",
          plan_type: planType,
          billing_cycle: billingCycle,
        },
      },
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create checkout session" },
      { status: 500 }
    );
  }
}

