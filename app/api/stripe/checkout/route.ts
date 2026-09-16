import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import type { BillingCycle } from "@/types/database";
import { validateStripeSecretKey } from "@/lib/stripe/env-guards";
import {
  assertSeatQuantity,
  getProPriceId,
  planTypeFromSeatCount,
  proPriceFields,
  proMonthlyEquivalentCents,
  inferSubscriptionFromStripeItems,
  totalSeatsFromLicenses,
} from "@/lib/stripe/pricing";
import Stripe from "stripe";

/**
 * POST /api/stripe/checkout
 *
 * New paid checkouts use Pro Price IDs from env + absolute seat quantity.
 * Body: { billingCycle, seatCount, forceCheckout?, trialPeriodDays?, customerEmail? }
 *
 * Backward compatible: also accepts { planType, additionalLicenses } and maps to seats.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    try {
      validateStripeSecretKey(process.env.STRIPE_SECRET_KEY);
    } catch (validationError: any) {
      console.error("Stripe configuration validation failed:", validationError.message);
      return NextResponse.json(
        { error: "Stripe configuration error", details: validationError.message },
        { status: 500 }
      );
    }

    const supabase = await createClient();
    const body = await request.json();

    const billingCycle = (body.billingCycle || "monthly") as BillingCycle;
    if (billingCycle !== "monthly" && billingCycle !== "yearly") {
      return NextResponse.json({ error: "Invalid billingCycle" }, { status: 400 });
    }

    let proPriceId: string;
    try {
      proPriceId = getProPriceId(billingCycle);
    } catch (envErr: any) {
      console.error(envErr.message);
      return NextResponse.json(
        { error: envErr.message || "Stripe Pro price IDs not configured" },
        { status: 500 }
      );
    }

    // Resolve absolute seat count (prefer seatCount; map legacy fields)
    let seatCount: number;
    try {
      if (body.seatCount != null) {
        seatCount = assertSeatQuantity(body.seatCount);
      } else if (body.planType === "organization") {
        seatCount = assertSeatQuantity(2 + (body.additionalLicenses || 0));
      } else if (body.planType === "individual" || body.planType === "free") {
        seatCount = assertSeatQuantity(1);
      } else {
        seatCount = assertSeatQuantity(body.additionalLicenses != null ? 1 + body.additionalLicenses : 1);
      }
    } catch (seatErr: any) {
      return NextResponse.json({ error: seatErr.message }, { status: 400 });
    }

    const planType = planTypeFromSeatCount(seatCount);
    const { forceCheckout = false, trialPeriodDays, customerEmail } = body as {
      forceCheckout?: boolean;
      trialPeriodDays?: number;
      customerEmail?: string;
    };

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const isAuthenticated = !!user;

    if (!isAuthenticated) {
      console.log("Creating unauthenticated checkout session for landing page purchase");
    }

    let customerId: string | undefined;
    let organizationId: string | undefined;

    if (isAuthenticated && user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", user.id)
        .single();

      if (profile?.stripe_customer_id) {
        customerId = profile.stripe_customer_id;
      } else {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { supabase_user_id: user.id },
        });
        customerId = customer.id;
        await supabase
          .from("profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", user.id);
      }

      const { data: orgData } = await supabase.rpc("get_user_organization_membership", {
        p_user_id: user.id,
      });
      organizationId = orgData?.[0]?.organization_id;

      if (!organizationId) {
        return NextResponse.json({ error: "Organization not found" }, { status: 404 });
      }

      const { data: existingSubscription } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("organization_id", organizationId)
        .in("status", ["active", "trialing"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const isFreeOrNoSub =
        !existingSubscription ||
        existingSubscription.plan_type === "free" ||
        !existingSubscription.stripe_subscription_id;

      // Free → Pro: create subscription in place if customer has a payment method
      if (isFreeOrNoSub && customerId && existingSubscription) {
        const pms = await stripe.paymentMethods.list({
          customer: customerId,
          type: "card",
          limit: 1,
        });

        if (pms.data.length > 0) {
          console.log("Creating Pro subscription in-place for free user with PM");
          const newSubscription = await stripe.subscriptions.create({
            customer: customerId,
            items: [{ price: proPriceId, quantity: seatCount }],
            metadata: {
              user_id: user.id,
              organization_id: organizationId,
              plan_type: planType,
              billing_cycle: billingCycle,
              seat_count: String(seatCount),
              product: "pro",
            },
          });

          const fields = proPriceFields(billingCycle, seatCount);
          const sub = newSubscription as any;
          const { data: dbUpdate, error: dbError } = await supabase
            .from("subscriptions")
            .update({
              stripe_subscription_id: newSubscription.id,
              stripe_customer_id: customerId,
              stripe_price_id: proPriceId,
              ...fields,
              billing_cycle: billingCycle,
              status: "active",
              current_period_start: sub.current_period_start
                ? new Date(sub.current_period_start * 1000).toISOString()
                : new Date().toISOString(),
              current_period_end: sub.current_period_end
                ? new Date(sub.current_period_end * 1000).toISOString()
                : null,
              trial_start_date: null,
              trial_end_date: null,
              pending_plan_change: null,
              updated_at: new Date().toISOString(),
            })
            .eq("organization_id", organizationId)
            .select()
            .single();

          if (dbError) console.error("Database update error:", dbError);

          return NextResponse.json({
            updated: true,
            subscriptionId: newSubscription.id,
            message: "Subscription activated successfully",
            subscription: dbUpdate,
          });
        }
      }

      // Active paid: update seats / cycle on same subscription
      if (existingSubscription?.stripe_subscription_id && !forceCheckout) {
        try {
          const stripeSubscription = (await stripe.subscriptions.retrieve(
            existingSubscription.stripe_subscription_id,
            { expand: ["items"] }
          )) as any;

          const inferred = inferSubscriptionFromStripeItems(stripeSubscription.items.data);
          const currentSeats = inferred.isPro
            ? inferred.seatCount
            : totalSeatsFromLicenses(
                existingSubscription.base_licenses || 1,
                existingSubscription.additional_licenses || 0
              );
          const currentCycle = (existingSubscription.billing_cycle ||
            inferred.billingCycle) as BillingCycle;

          const currentMonthly = inferred.isPro
            ? proMonthlyEquivalentCents(currentCycle, currentSeats)
            : estimateLegacyMonthlyCents(
                existingSubscription.plan_type,
                currentCycle,
                existingSubscription.additional_licenses || 0
              );
          const newMonthly = proMonthlyEquivalentCents(billingCycle, seatCount);
          const isUpgrade =
            newMonthly > currentMonthly ||
            (newMonthly === currentMonthly &&
              currentCycle === "monthly" &&
              billingCycle === "yearly");

          // Downgrade (cheaper or yearly→monthly at lower/same commitment): schedule at period end
          if (!isUpgrade && (newMonthly < currentMonthly || (currentCycle === "yearly" && billingCycle === "monthly"))) {
            const pendingChange = {
              plan_type: planType,
              billing_cycle: billingCycle,
              additional_licenses: seatCount - 1,
              seat_count: seatCount,
              scheduled_for: existingSubscription.current_period_end,
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

            if (updateError) throw updateError;

            return NextResponse.json({
              updated: true,
              scheduled: true,
              effectiveDate: existingSubscription.current_period_end,
              message: "Change scheduled for next billing period",
              subscription: updatedSub,
            });
          }

          // Upgrade / seat increase / cycle change: apply now with standard proration
          const itemUpdates: Stripe.SubscriptionUpdateParams.Item[] = [];

          if (inferred.isPro) {
            // Absolute quantity on existing Pro item; swap price if cycle changed
            const proItem = stripeSubscription.items.data.find((item: any) =>
              inferred.priceId ? item.price.id === inferred.priceId : true
            );
            stripeSubscription.items.data.forEach((item: any) => {
              if (proItem && item.id === proItem.id) {
                itemUpdates.push({
                  id: item.id,
                  price: proPriceId,
                  quantity: seatCount,
                });
              } else {
                itemUpdates.push({ id: item.id, deleted: true });
              }
            });
            if (!proItem) {
              itemUpdates.push({ price: proPriceId, quantity: seatCount });
            }
          } else {
            // Grandfathered → voluntary move onto Pro (same subscription, replace items)
            stripeSubscription.items.data.forEach((item: any) => {
              itemUpdates.push({ id: item.id, deleted: true });
            });
            itemUpdates.push({ price: proPriceId, quantity: seatCount });
          }

          const cycleChanged = currentCycle !== billingCycle;
          const updateParams: Stripe.SubscriptionUpdateParams = {
            items: itemUpdates,
            // Seat changes: standard proration. Cycle change: also prorate; preview shown in UI first.
            proration_behavior: "create_prorations",
            metadata: {
              user_id: user.id,
              organization_id: organizationId,
              plan_type: planType,
              billing_cycle: billingCycle,
              seat_count: String(seatCount),
              product: "pro",
            },
          };

          if (cycleChanged) {
            updateParams.billing_cycle_anchor = "now";
          }

          if (stripeSubscription.status === "trialing") {
            updateParams.trial_end = "now";
          }

          const updatedSubscription = await stripe.subscriptions.update(
            existingSubscription.stripe_subscription_id,
            updateParams
          );

          const fields = proPriceFields(billingCycle, seatCount);
          const sub = updatedSubscription as any;
          const { data: dbUpdate, error: dbError } = await supabase
            .from("subscriptions")
            .update({
              ...fields,
              billing_cycle: billingCycle,
              stripe_price_id: proPriceId,
              pending_plan_change: null,
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
              message: "Subscription updated successfully",
            });
          }

          return NextResponse.json({
            updated: true,
            subscriptionId: updatedSubscription.id,
            message: "Subscription updated successfully",
            subscription: dbUpdate,
          });
        } catch (updateError: any) {
          console.error("Failed to update subscription:", updateError);
          console.log("Falling through to create new checkout session");
        }
      }
    }

    // New Checkout Session (auth or landing)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3003";
    const successUrl = isAuthenticated
      ? `${baseUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}&plan=${planType}`
      : `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = isAuthenticated ? `${baseUrl}/dashboard` : `${baseUrl}/pricing`;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [{ price: proPriceId, quantity: seatCount }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      payment_method_types: ["card"],
      metadata: {
        plan_type: planType,
        billing_cycle: billingCycle,
        seat_count: String(seatCount),
        additional_licenses: String(seatCount - 1),
        product: "pro",
      },
      subscription_data: {
        metadata: {
          plan_type: planType,
          billing_cycle: billingCycle,
          seat_count: String(seatCount),
          product: "pro",
        },
      },
    };

    if (isAuthenticated && customerId) {
      sessionParams.customer = customerId;
      sessionParams.metadata!.user_id = user!.id;
      sessionParams.metadata!.organization_id = organizationId || "";
      sessionParams.subscription_data!.metadata!.user_id = user!.id;
      sessionParams.subscription_data!.metadata!.organization_id = organizationId || "";
    } else {
      sessionParams.metadata!.landing_page_purchase = "true";
      if (customerEmail) {
        sessionParams.customer_email = customerEmail;
      }
    }

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

function estimateLegacyMonthlyCents(
  planType: string,
  cycle: BillingCycle,
  additionalLicenses: number
): number {
  // Approximate grandfathered list prices for upgrade comparison only
  if (planType === "individual") {
    return cycle === "monthly" ? 7900 : 6500;
  }
  if (planType === "organization") {
    const base = cycle === "monthly" ? 15800 : 13000;
    const per = cycle === "monthly" ? 7900 : 6500;
    return base + additionalLicenses * per;
  }
  return 0;
}
