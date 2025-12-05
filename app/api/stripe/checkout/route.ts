import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { STRIPE_PRICE_IDS, STRIPE_CONFIG } from "@/lib/stripe/config";
import type { PlanType, BillingCycle } from "@/types/database";
import { PLAN_PRICING } from "@/types/database";
import Stripe from "stripe";

export async function POST(request: NextRequest) {
  try {
    // Runtime check for Stripe key
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const supabase = await createClient();
    
    // Parse request body first
    const body = await request.json();
    const { planType, billingCycle, additionalLicenses = 0, forceCheckout = false, trialPeriodDays, customerEmail } = body as {
      planType: PlanType;
      billingCycle: BillingCycle;
      additionalLicenses: number;
      forceCheckout?: boolean;
      trialPeriodDays?: number;
      customerEmail?: string; // For unauthenticated landing page purchases
    };

    // Check authentication (optional for landing page purchases)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    const isAuthenticated = !!user;

    // For unauthenticated users, we'll create a checkout session without linking to a user
    // The webhook will handle user creation after successful payment
    if (!isAuthenticated) {
      // For landing page purchases, proceed without user
      console.log('Creating unauthenticated checkout session for landing page purchase');
    }

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
    let customerId: string | undefined;
    let organizationId: string | undefined;

    if (isAuthenticated && user) {
      // Authenticated user flow - get/create customer and org
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

      organizationId = orgData?.[0]?.organization_id;

      if (!organizationId) {
        return NextResponse.json(
          { error: "Organization not found" },
          { status: 404 }
        );
      }

      // Check if organization already has an active subscription
      // Only look for active/trialing subscriptions, ordered by most recent
      const { data: existingSubscription } = await supabase
        .from("subscriptions")
        .select("stripe_subscription_id, plan_type, billing_cycle, status")
        .eq("organization_id", organizationId)
        .in("status", ["active", "trialing"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(); // Use maybeSingle instead of single to handle 0 results gracefully

      // If active subscription exists AND forceCheckout is not true, check if upgrade or downgrade
      // Upgrades: immediate with proration, Downgrades: scheduled for period end
      if (existingSubscription?.stripe_subscription_id && !forceCheckout) {
      try {
        // Determine if this is an upgrade by comparing total prices
        const isUpgrade = determineIfUpgrade(
          existingSubscription.plan_type,
          existingSubscription.billing_cycle,
          0, // We'll get this from full subscription data
          planType,
          billingCycle,
          additionalLicenses
        );

        // Get full subscription data for current_period_end
        // Query for the specific subscription we're updating
        const { data: fullSubscription } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("stripe_subscription_id", existingSubscription.stripe_subscription_id)
          .single();

        if (!fullSubscription) {
          throw new Error("Subscription not found");
        }

        // If downgrade, schedule it for period end
        if (!isUpgrade) {
          console.log("Scheduling downgrade for period end");
          
          // Store pending plan change in database
          const pendingChange = {
            plan_type: planType,
            billing_cycle: billingCycle,
            additional_licenses: additionalLicenses,
            scheduled_for: fullSubscription.current_period_end,
            created_at: new Date().toISOString(),
          };

          const { data: updatedSub, error: updateError } = await supabase
            .from("subscriptions")
            .update({
              pending_plan_change: pendingChange,
              updated_at: new Date().toISOString(),
            })
            .eq("organization_id", organizationId)
            .select()
            .single();

          if (updateError) {
            console.error("Failed to store pending plan change:", updateError);
            throw updateError;
          }

          return NextResponse.json({
            updated: true,
            scheduled: true,
            effectiveDate: fullSubscription.current_period_end,
            message: "Downgrade scheduled for next billing period",
            subscription: updatedSub // Include updated subscription
          });
        }

        // If upgrade, proceed with immediate update
        console.log("Processing immediate upgrade");

        // Determine billing behavior based on plan change type
        const currentCycle = existingSubscription.billing_cycle;
        const newCycle = billingCycle;
        
        // Retrieve subscription with expanded items
        const stripeSubscription = await stripe.subscriptions.retrieve(
          existingSubscription.stripe_subscription_id,
          { expand: ['items'] }
        ) as any;

        // Build items array: delete all old items, then add new ones
        const itemUpdates: any[] = [];

        // Mark all existing items for deletion
        stripeSubscription.items.data.forEach((item: any) => {
          itemUpdates.push({
            id: item.id,
            deleted: true,
          });
        });

        // Add new items based on plan type
        if (planType === "individual") {
          const priceId =
            billingCycle === "monthly"
              ? STRIPE_PRICE_IDS.individual.monthly
              : STRIPE_PRICE_IDS.individual.yearly;

          itemUpdates.push({
            price: priceId,
            quantity: 1,
          });
        } else if (planType === "organization") {
          const basePriceId =
            billingCycle === "monthly"
              ? STRIPE_PRICE_IDS.organization.base.monthly
              : STRIPE_PRICE_IDS.organization.base.yearly;

          itemUpdates.push({
            price: basePriceId,
            quantity: 1,
          });

          if (additionalLicenses > 0) {
            const licensePriceId =
              billingCycle === "monthly"
                ? STRIPE_PRICE_IDS.organization.additionalLicense.monthly
                : STRIPE_PRICE_IDS.organization.additionalLicense.yearly;

            itemUpdates.push({
              price: licensePriceId,
              quantity: additionalLicenses,
            });
          }
        }

        // Determine proration_behavior and billing_cycle_anchor based on scenario
        let prorationBehavior: "none" | "always_invoice" = "always_invoice";
        let billingCycleAnchor: "now" | "unchanged" | undefined = undefined;

        // Monthly → Yearly: No proration, reset anchor
        if (currentCycle === "monthly" && newCycle === "yearly") {
          prorationBehavior = "none";
          billingCycleAnchor = "now";
          console.log("Monthly → Yearly: Charging full year, resetting billing anchor");
        }
        // Monthly → Monthly (upgrade): No proration, reset anchor
        else if (currentCycle === "monthly" && newCycle === "monthly") {
          prorationBehavior = "none";
          billingCycleAnchor = "now";
          console.log("Monthly → Monthly upgrade: Charging full month, resetting billing anchor");
        }
        // Yearly → Yearly (upgrade): Prorate, keep anchor
        else if (currentCycle === "yearly" && newCycle === "yearly") {
          prorationBehavior = "always_invoice";
          billingCycleAnchor = "unchanged";
          console.log("Yearly → Yearly upgrade: Prorating difference, keeping billing anchor");
        }

        // Update the existing subscription
        const updateParams: any = {
          items: itemUpdates,
          proration_behavior: prorationBehavior,
          metadata: {
            user_id: user.id,
            organization_id: organizationId,
            plan_type: planType,
            billing_cycle: billingCycle,
          },
        };

        // Add billing_cycle_anchor if we're resetting it
        if (billingCycleAnchor === "now") {
          updateParams.billing_cycle_anchor = "now";
        }

        const updatedSubscription = await stripe.subscriptions.update(
          existingSubscription.stripe_subscription_id,
          updateParams
        );

        console.log("Successfully updated Stripe subscription:", updatedSubscription.id);
        console.log("New plan:", planType, "New cycle:", billingCycle);

        // Calculate pricing for database update using PLAN_PRICING constant
        const baseLicenses = planType === "organization" ? PLAN_PRICING.organization.baseLicenses : 1;
        let basePriceCents = 0;
        if (planType === "individual") {
          basePriceCents = PLAN_PRICING.individual[billingCycle];
        } else {
          basePriceCents = PLAN_PRICING.organization[billingCycle].base;
        }
        const additionalLicensePriceCents = planType === "organization"
          ? PLAN_PRICING.organization[billingCycle].perAdditionalLicense
          : 0;

        // Cast to any to work around Stripe API type mismatch
        const sub = updatedSubscription as any;

        // Update subscription in database
        const { data: dbUpdate, error: dbError } = await supabase
          .from("subscriptions")
          .update({
            plan_type: planType,
            billing_cycle: billingCycle,
            base_licenses: baseLicenses,
            additional_licenses: additionalLicenses,
            base_price_cents: basePriceCents,
            additional_license_price_cents: additionalLicensePriceCents,
            pending_plan_change: null, // Clear any pending downgrade
            current_period_start: sub.current_period_start
              ? new Date(sub.current_period_start * 1000).toISOString()
              : null,
            current_period_end: sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", organizationId)
          .select()
          .single();

        if (dbError) {
          console.error("Database update error:", dbError);
          return NextResponse.json({ 
            updated: true,
            subscriptionId: updatedSubscription.id,
            message: "Subscription updated successfully"
          });
        }

        console.log("Database updated successfully:", dbUpdate);

        // Return the updated subscription data so UI can refresh immediately
        return NextResponse.json({ 
          updated: true,
          subscriptionId: updatedSubscription.id,
          message: "Subscription updated successfully",
          subscription: dbUpdate // Include the updated subscription
        });
      } catch (updateError: any) {
        console.error("Failed to update subscription:", updateError);
        console.error("Update error details:", updateError.message);
        // If update fails, fall through to create new checkout session
      }
    }
    // End of authenticated user block

    // No active subscription OR unauthenticated user - create new checkout session
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
    
    // Different success URLs for authenticated vs unauthenticated
    const successUrl = isAuthenticated 
      ? `${baseUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}&plan=${planType}`
      : `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = isAuthenticated ? `${baseUrl}/dashboard` : baseUrl;

    console.log("Creating Stripe Checkout with success_url:", successUrl);
    console.log("Base URL from env:", process.env.NEXT_PUBLIC_APP_URL);
    console.log("Authenticated:", isAuthenticated);

    // Create Checkout Session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
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
        plan_type: planType,
        billing_cycle: billingCycle,
        additional_licenses: additionalLicenses.toString(),
      },
      subscription_data: {
        metadata: {
          plan_type: planType,
          billing_cycle: billingCycle,
        },
      },
    };

    // Add customer info based on authentication status
    if (isAuthenticated && customerId) {
      sessionParams.customer = customerId;
      sessionParams.metadata!.user_id = user!.id;
      sessionParams.metadata!.organization_id = organizationId || "";
      sessionParams.subscription_data!.metadata!.user_id = user!.id;
      sessionParams.subscription_data!.metadata!.organization_id = organizationId || "";
    } else {
      // For unauthenticated users, Stripe will collect email
      sessionParams.customer_creation = 'always';
      // Store flag to indicate this is a landing page purchase
      sessionParams.metadata!.landing_page_purchase = 'true';
    }

    // Add trial period if specified (e.g., 14-day trial)
    if (trialPeriodDays && trialPeriodDays > 0) {
      sessionParams.subscription_data!.trial_period_days = trialPeriodDays;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create checkout session" },
      { status: 500 }
    );
  }
}

// Helper function to determine if a plan change is an upgrade based on total price
function determineIfUpgrade(
  currentPlan: PlanType,
  currentCycle: BillingCycle | null,
  currentAdditionalLicenses: number,
  newPlan: PlanType,
  newCycle: BillingCycle,
  newAdditionalLicenses: number
): boolean {
  if (!currentCycle) return true; // Free trial to paid is always upgrade

  // RULE: Monthly → Yearly is ALWAYS an upgrade (immediate change with charge)
  // This is because yearly plans represent a commitment and should take effect immediately
  if (currentCycle === "monthly" && newCycle === "yearly") {
    return true;
  }

  // RULE: Yearly → Monthly is ALWAYS a downgrade (scheduled for period end)
  // Customer is switching from committed yearly to flexible monthly
  if (currentCycle === "yearly" && newCycle === "monthly") {
    return false;
  }

  // For same billing cycle (monthly→monthly or yearly→yearly), compare prices
  // Calculate MONTHLY price for current plan (all prices in PLAN_PRICING are monthly)
  let currentMonthlyPrice = 0;
  if (currentPlan === "individual") {
    currentMonthlyPrice = PLAN_PRICING.individual[currentCycle];
  } else if (currentPlan === "organization") {
    const baseCost = PLAN_PRICING.organization[currentCycle].base;
    const licenseCost = currentAdditionalLicenses * PLAN_PRICING.organization[currentCycle].perAdditionalLicense;
    currentMonthlyPrice = baseCost + licenseCost;
  }

  // Calculate MONTHLY price for new plan (all prices in PLAN_PRICING are monthly)
  let newMonthlyPrice = 0;
  if (newPlan === "individual") {
    newMonthlyPrice = PLAN_PRICING.individual[newCycle];
  } else if (newPlan === "organization") {
    const baseCost = PLAN_PRICING.organization[newCycle].base;
    const licenseCost = newAdditionalLicenses * PLAN_PRICING.organization[newCycle].perAdditionalLicense;
    newMonthlyPrice = baseCost + licenseCost;
  }

  // Compare monthly prices - if new price is higher, it's an upgrade
  return newMonthlyPrice > currentMonthlyPrice;
}

