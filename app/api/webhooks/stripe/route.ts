import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { stripe } from "@/lib/stripe/client";
import { createServiceRoleClient } from "@/lib/supabase/server";
import Stripe from "stripe";
import { PLAN_PRICING } from "@/types/database";
import { sendWelcomeEmail } from "@/lib/email/welcomeEmail";
import { validateStripeSecretKey, validateWebhookSecret } from "@/lib/stripe/env-guards";
import {
  inferSubscriptionFromStripeItems,
  planTypeFromSeatCount,
  proPriceFields,
  seatsToLicenseFields,
} from "@/lib/stripe/pricing";

export async function POST(request: NextRequest) {
  // Runtime check for Stripe key and webhook secret
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  // Validate that Stripe webhook is properly configured for the current environment
  try {
    validateStripeSecretKey(process.env.STRIPE_SECRET_KEY);
    validateWebhookSecret(process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_SECRET_KEY);
  } catch (validationError: any) {
    console.error("Stripe webhook configuration validation failed:", validationError.message);
    return NextResponse.json(
      { error: "Stripe webhook configuration error", details: validationError.message },
      { status: 500 }
    );
  }

  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return NextResponse.json(
      { error: `Webhook Error: ${err.message}` },
      { status: 400 }
    );
  }

  // Use service role client to bypass RLS
  const supabase = createServiceRoleClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session, supabase);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(subscription, supabase);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription, supabase);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentSucceeded(invoice, supabase);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice, supabase);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error("Webhook handler error:", error);
    return NextResponse.json(
      { error: error.message || "Webhook handler failed" },
      { status: 500 }
    );
  }
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  supabase: any
) {
  let userId = session.metadata?.user_id;
  let organizationId = session.metadata?.organization_id;
  const billingCycle = (session.metadata?.billing_cycle || "monthly") as "monthly" | "yearly";
  const seatCountMeta = parseInt(session.metadata?.seat_count || "0", 10);
  const additionalLicensesMeta = parseInt(session.metadata?.additional_licenses || "0", 10);
  // Prefer seat_count; fall back to legacy additional_licenses (+1 base)
  const seatCount =
    seatCountMeta > 0
      ? seatCountMeta
      : Math.max(1, 1 + additionalLicensesMeta);
  const planType =
    (session.metadata?.plan_type as "individual" | "organization") ||
    planTypeFromSeatCount(seatCount);
  const isLandingPagePurchase = session.metadata?.landing_page_purchase === 'true';

  // Handle landing page purchase (no existing user)
  // Get customer email from either customer_email or customer_details.email
  const customerEmail = session.customer_email || session.customer_details?.email;
  
  if (isLandingPagePurchase && !userId && customerEmail) {
    console.log('Processing landing page purchase for:', customerEmail);
    
    try {
      // Check if user already exists
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      
      const existingUser = existingUsers?.users?.find(
        (u: any) => u.email === customerEmail
      );
      
      if (existingUser) {
        console.log('User already exists, using existing account:', existingUser.id);
        userId = existingUser.id;
        
        // Get user's organization
        const { data: orgData } = await supabase.rpc(
          "get_user_organization_membership",
          { p_user_id: userId }
        );
        
        if (!orgData || orgData.length === 0) {
          throw new Error('Existing user has no organization');
        }
        
        organizationId = orgData[0].organization_id;
      } else {
        // Create new user account
        console.log('Creating new user account for:', customerEmail);
        
        const { data: newUser, error: createUserError } = await supabase.auth.admin.createUser({
          email: customerEmail,
          email_confirm: true,
          user_metadata: {
            full_name: session.customer_details?.name || '',
          },
          // Generate a random password - user will set their own via password reset email
          password: crypto.randomUUID() + crypto.randomUUID(),
        });
        
        if (createUserError || !newUser.user) {
          console.error('Detailed createUser error:', JSON.stringify(createUserError, null, 2));
          console.error('newUser data:', JSON.stringify(newUser, null, 2));
          throw new Error(`Failed to create user: ${createUserError?.message || 'Unknown error'}`);
        }
        
        userId = newUser.user.id;
        console.log('User created:', userId);
        
        // Wait for trigger to create organization
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const { data: orgData, error: orgError } = await supabase.rpc(
          "get_user_organization_membership",
          { p_user_id: userId }
        );
        
        if (orgError || !orgData || orgData.length === 0) {
          throw new Error('Failed to get user organization');
        }
        
        organizationId = orgData[0].organization_id;
        console.log('Organization found:', organizationId);
        
        // Send password setup email
        try {
          const { error: resetError } = await supabase.auth.resetPasswordForEmail(
            customerEmail,
            {
              redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/auth/reset-password`,
            }
          );
          
          if (resetError) {
            console.error('❌ CRITICAL: Password setup email failed:', {
              error: resetError,
              errorMessage: resetError.message,
              email: customerEmail,
              appUrl: process.env.NEXT_PUBLIC_APP_URL,
              redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/auth/reset-password`,
              timestamp: new Date().toISOString()
            });
            // Don't throw - let checkout complete, but flag the issue
          } else {
            console.log('✅ Password setup email sent successfully to:', customerEmail);
          }
        } catch (emailError: any) {
          console.error('❌ CRITICAL: Password setup email exception:', {
            error: emailError,
            errorMessage: emailError?.message,
            email: customerEmail,
            appUrl: process.env.NEXT_PUBLIC_APP_URL,
            timestamp: new Date().toISOString()
          });
          // Don't throw - let checkout complete, but flag the issue
        }

        // Send welcome email via Resend (in addition to password setup)
        try {
          const firstName = session.customer_details?.name?.split(' ')[0];
          await sendWelcomeEmail(customerEmail, firstName);
          console.log('✅ Welcome email sent via Resend to:', customerEmail);
        } catch (emailError: any) {
          console.error('⚠️ Welcome email failed (non-critical):', {
            error: emailError,
            errorMessage: emailError?.message,
            email: customerEmail,
            resendApiKeySet: !!process.env.RESEND_API_KEY,
            timestamp: new Date().toISOString()
          });
          // Don't fail the whole checkout if welcome email fails
        }
      }
      
      console.log('Landing page purchase setup complete, proceeding to create subscription');
    } catch (error: any) {
      console.error('Failed to handle landing page purchase:', error);
      throw new Error(`Landing page purchase failed: ${error.message}`);
    }
  }

  if (!userId || !organizationId) {
    console.error("Missing user_id or organization_id in session metadata");
    return;
  }

  // Get the subscription details
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  if (!subscriptionId) {
    console.error("No subscription ID found in checkout session");
    return;
  }

  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId) as any;

  // Save stripe_customer_id to the user's profile
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (customerId && userId) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (profileError) {
      console.error("Failed to save stripe_customer_id to profile:", profileError);
    } else {
      console.log(`Saved stripe_customer_id ${customerId} to profile ${userId}`);
    }
  }

  // CRITICAL FIX: Check if organization already has a different active subscription
  // If so, cancel the old one to prevent double-billing
  const { data: existingSubscriptions, error: checkError } = await supabase
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .eq("organization_id", organizationId)
    .neq("stripe_subscription_id", subscriptionId)
    .in("status", ["active", "trialing"]);

  if (!checkError && existingSubscriptions && existingSubscriptions.length > 0) {
    console.log(`Found ${existingSubscriptions.length} existing active subscription(s) for organization ${organizationId}`);
    
    // Cancel all old subscriptions in Stripe
    for (const oldSub of existingSubscriptions) {
      try {
        console.log(`Canceling old Stripe subscription: ${oldSub.stripe_subscription_id}`);
        await stripe.subscriptions.cancel(oldSub.stripe_subscription_id);
        
        // Update database to mark as canceled
        await supabase
          .from("subscriptions")
          .update({
            status: "canceled",
            cancel_at_period_end: true,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", oldSub.stripe_subscription_id);
        
        console.log(`Successfully canceled old subscription: ${oldSub.stripe_subscription_id}`);
      } catch (cancelError: any) {
        console.error(`Failed to cancel old subscription ${oldSub.stripe_subscription_id}:`, cancelError);
        // Continue anyway - we'll still create the new subscription
      }
    }
  }

  const inferred = inferSubscriptionFromStripeItems(stripeSubscription.items?.data || []);
  const resolvedSeats = inferred.seatCount || seatCount;
  const resolvedCycle = inferred.billingCycle || billingCycle;
  const resolvedPlan = planTypeFromSeatCount(resolvedSeats);
  const priceFields = inferred.isPro
    ? proPriceFields(resolvedCycle, resolvedSeats)
    : inferred.isLegacy
      ? {
          ...seatsToLicenseFields(resolvedSeats),
          // Keep legacy seat mapping: org base 2 + additional
          base_licenses: inferred.planType === "organization" ? 2 : 1,
          additional_licenses:
            inferred.planType === "organization" ? Math.max(0, resolvedSeats - 2) : 0,
          base_price_cents:
            inferred.planType === "organization"
              ? PLAN_PRICING.legacy.organization[resolvedCycle].base
              : PLAN_PRICING.legacy.individual[resolvedCycle],
          additional_license_price_cents:
            inferred.planType === "organization"
              ? PLAN_PRICING.legacy.organization[resolvedCycle].perAdditionalLicense
              : 0,
          plan_type: inferred.planType,
        }
      : proPriceFields(resolvedCycle, resolvedSeats);

  // Update subscription in database
  const { data: updateData, error } = await supabase
    .from("subscriptions")
    .update({
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      stripe_price_id: inferred.priceId,
      plan_type: priceFields.plan_type || resolvedPlan,
      billing_cycle: resolvedCycle,
      status: stripeSubscription.status || "active",
      base_licenses: priceFields.base_licenses,
      additional_licenses: priceFields.additional_licenses,
      base_price_cents: priceFields.base_price_cents,
      additional_license_price_cents: priceFields.additional_license_price_cents,
      current_period_start: stripeSubscription.current_period_start
        ? new Date(stripeSubscription.current_period_start * 1000).toISOString()
        : null,
      current_period_end: stripeSubscription.current_period_end
        ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
        : null,
      trial_start_date: stripeSubscription.trial_start
        ? new Date(stripeSubscription.trial_start * 1000).toISOString()
        : null,
      trial_end_date: stripeSubscription.trial_end
        ? new Date(stripeSubscription.trial_end * 1000).toISOString()
        : null,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .select();

  if (error) {
    console.error("Failed to update subscription:", error);
    console.error("Organization ID:", organizationId);
    console.error("Subscription ID:", subscriptionId);
    throw error;
  }

  if (!updateData || updateData.length === 0) {
    console.error("No subscription found for organization:", organizationId);
    throw new Error("Subscription update returned no rows");
  }

  console.log(`Subscription activated for organization ${organizationId}`, updateData[0]);
  
  // VERIFY: Read back from database to confirm update actually worked
  const { data: verifyData, error: verifyError } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("organization_id", organizationId)
    .single();
  
  if (verifyError) {
    console.error("Failed to verify subscription update:", verifyError);
  } else {
    console.log("VERIFICATION - Database actually contains:", verifyData);
  }
}

async function handleSubscriptionUpdate(
  subscription: Stripe.Subscription,
  supabase: any
) {
  // Type assertion to work around Stripe type issues
  const sub = subscription as any;
  const organizationId = sub.metadata?.organization_id;
  const hasPendingUpdate = !!sub.pending_update;

  if (!organizationId) {
    console.warn(
      `[webhook] subscription ${subscription.id} missing organization_id in metadata — syncing by stripe_subscription_id`
    );
  }

  const inferred = inferSubscriptionFromStripeItems(sub.items?.data || []);
  let billingCycle = inferred.billingCycle;
  // Source of truth for entitlements: applied item quantities — never pending metadata
  let seatCount = inferred.seatCount;

  // Metadata overrides only when the pending update has been applied (no pending_update).
  // While payment is incomplete, metadata may already list the target seat_count —
  // granting those seats early would bypass pending_if_incomplete semantics.
  if (!hasPendingUpdate) {
    if (sub.metadata?.billing_cycle === "monthly" || sub.metadata?.billing_cycle === "yearly") {
      billingCycle = sub.metadata.billing_cycle;
    }
    if (sub.metadata?.seat_count) {
      const metaSeats = parseInt(sub.metadata.seat_count, 10);
      if (Number.isFinite(metaSeats) && metaSeats >= 1) seatCount = metaSeats;
    }
  } else {
    console.log(
      `[webhook] subscription.updated with pending_update — keeping applied seats=${seatCount} (not granting pending quantity)`
    );
  }

  const priceFields = inferred.isPro
    ? proPriceFields(billingCycle, seatCount)
    : inferred.isLegacy
      ? {
          plan_type: inferred.planType,
          base_licenses: inferred.planType === "organization" ? 2 : 1,
          additional_licenses:
            inferred.planType === "organization" ? Math.max(0, seatCount - 2) : 0,
          base_price_cents:
            inferred.planType === "organization"
              ? PLAN_PRICING.legacy.organization[billingCycle].base
              : PLAN_PRICING.legacy.individual[billingCycle],
          additional_license_price_cents:
            inferred.planType === "organization"
              ? PLAN_PRICING.legacy.organization[billingCycle].perAdditionalLicense
              : 0,
        }
      : proPriceFields(billingCycle, seatCount);

  // Prefer seat-derived plan_type for Pro; honor metadata for legacy if set
  if (inferred.isPro) {
    // plan_type always from seats
  } else if (
    !hasPendingUpdate &&
    (sub.metadata?.plan_type === "individual" || sub.metadata?.plan_type === "organization")
  ) {
    (priceFields as any).plan_type = sub.metadata.plan_type;
  }

  const currentPeriodStart = sub.current_period_start
    ? new Date(sub.current_period_start * 1000).toISOString()
    : null;
  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  // Terminal paid end → perpetual Free entitlements (preserve org data)
  if (
    sub.status === "canceled" ||
    sub.status === "unpaid" ||
    sub.status === "incomplete_expired"
  ) {
    const { error: freeError } = await supabase
      .from("subscriptions")
      .update({
        plan_type: "free",
        status: "active",
        stripe_subscription_id: null,
        stripe_price_id: null,
        trial_start_date: null,
        trial_end_date: null,
        additional_licenses: 0,
        base_licenses: 1,
        base_price_cents: 0,
        additional_license_price_cents: 0,
        pending_plan_change: null,
        cancel_at_period_end: false,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_subscription_id", subscription.id);

    if (freeError) {
      console.error("Failed to move canceled subscription to Free:", freeError);
      throw freeError;
    }
    console.log(`Subscription ${subscription.id} ended — moved to Free entitlements`);
    return;
  }

  const updateData: any = {
    plan_type: priceFields.plan_type,
    billing_cycle: billingCycle,
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    base_licenses: priceFields.base_licenses,
    additional_licenses: priceFields.additional_licenses,
    base_price_cents: priceFields.base_price_cents,
    additional_license_price_cents: priceFields.additional_license_price_cents,
    stripe_price_id: inferred.priceId,
    updated_at: new Date().toISOString(),
  };

  if (currentPeriodStart) updateData.current_period_start = currentPeriodStart;
  if (currentPeriodEnd) updateData.current_period_end = currentPeriodEnd;

  console.log("Updating subscription with data:", {
    stripe_subscription_id: subscription.id,
    pending_update: hasPendingUpdate,
    updateData,
  });

  const { data: updatedData, error } = await supabase
    .from("subscriptions")
    .update(updateData)
    .eq("stripe_subscription_id", subscription.id)
    .select();

  if (error) {
    console.error("Failed to update subscription:", error);
    console.error("Subscription ID:", subscription.id);
    throw error;
  }

  if (!updatedData || updatedData.length === 0) {
    console.error("No subscription found with stripe_subscription_id:", subscription.id);
    throw new Error("Subscription update returned no rows");
  }

  console.log(
    `[webhook] ✅ subscription.updated | ${subscription.id} | seats: ${seatCount} | pending: ${hasPendingUpdate}`
  );
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  supabase: any
) {
  // Preserve org data; switch entitlements to perpetual Free
  const { error } = await supabase
    .from("subscriptions")
    .update({
      plan_type: "free",
      status: "active",
      stripe_subscription_id: null,
      trial_start_date: null,
      trial_end_date: null,
      additional_licenses: 0,
      base_licenses: 1,
      base_price_cents: 0,
      additional_license_price_cents: 0,
      pending_plan_change: null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id);

  if (error) {
    console.error("Failed to downgrade canceled subscription to Free:", error);
    throw error;
  }

  console.log(
    `Subscription ${subscription.id} ended — organization moved to Free entitlements`,
  );
}

async function syncSubscriptionSeatsFromStripe(
  stripeSubscriptionId: string,
  supabase: any
) {
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ["items"],
  });
  const sub = subscription as any;

  // If payment still incomplete, do not grant pending seats
  if (sub.pending_update) {
    console.log(
      `[webhook] skip seat sync — pending_update still present on ${stripeSubscriptionId}`
    );
    return;
  }

  const inferred = inferSubscriptionFromStripeItems(sub.items?.data || []);
  let billingCycle = inferred.billingCycle;
  let seatCount = inferred.seatCount;

  if (sub.metadata?.billing_cycle === "monthly" || sub.metadata?.billing_cycle === "yearly") {
    billingCycle = sub.metadata.billing_cycle;
  }

  const priceFields = inferred.isPro
    ? proPriceFields(billingCycle, seatCount)
    : inferred.isLegacy
      ? {
          plan_type: inferred.planType,
          base_licenses: inferred.planType === "organization" ? 2 : 1,
          additional_licenses:
            inferred.planType === "organization" ? Math.max(0, seatCount - 2) : 0,
          base_price_cents:
            inferred.planType === "organization"
              ? PLAN_PRICING.legacy.organization[billingCycle].base
              : PLAN_PRICING.legacy.individual[billingCycle],
          additional_license_price_cents:
            inferred.planType === "organization"
              ? PLAN_PRICING.legacy.organization[billingCycle].perAdditionalLicense
              : 0,
        }
      : proPriceFields(billingCycle, seatCount);

  const { error } = await supabase
    .from("subscriptions")
    .update({
      plan_type: priceFields.plan_type,
      billing_cycle: billingCycle,
      status: sub.status === "active" ? "active" : sub.status,
      base_licenses: priceFields.base_licenses,
      additional_licenses: priceFields.additional_licenses,
      base_price_cents: priceFields.base_price_cents,
      additional_license_price_cents: priceFields.additional_license_price_cents,
      stripe_price_id: inferred.priceId,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", stripeSubscriptionId);

  if (error) {
    console.error("[webhook] failed to sync seats after payment:", error);
    throw error;
  }

  console.log(
    `[webhook] ✅ payment sync | ${stripeSubscriptionId} | seats: ${seatCount}`
  );
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice, supabase: any) {
  const inv = invoice as any;
  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
  const billingReason = inv.billing_reason as string | undefined;

  console.log(
    `[webhook] invoice.payment_succeeded | ${invoice.id} | reason: ${billingReason} | sub: ${subscriptionId}`
  );

  // Mid-cycle seat / plan changes invoice after pending_if_incomplete + always_invoice
  if (
    subscriptionId &&
    (billingReason === "subscription_update" || billingReason === "manual")
  ) {
    await syncSubscriptionSeatsFromStripe(subscriptionId, supabase);
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice, supabase: any) {
  // Type assertion to work around Stripe type issues
  const inv = invoice as any;
  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
  const billingReason = inv.billing_reason as string | undefined;

  if (!subscriptionId) return;

  // Mid-cycle seat increase failures: keep current entitlements; do not mark past_due.
  // Stripe leaves the subscription active with pending_update (or discards it).
  if (billingReason === "subscription_update") {
    console.log(
      `[webhook] ❌ seat/plan update payment failed | invoice: ${invoice.id} | sub: ${subscriptionId} — seats not granted`
    );
    // Ensure DB still reflects applied (pre-update) quantity
    try {
      await syncSubscriptionSeatsFromStripe(subscriptionId, supabase);
    } catch (e) {
      console.error("[webhook] resync after failed update payment:", e);
    }
    return;
  }

  // Renewal / first invoice failures → past_due
  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "past_due",
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscriptionId);

  if (error) {
    console.error("Failed to update subscription after payment failure:", error);
  }

  console.log(`[webhook] ❌ payment failed | sub: ${subscriptionId} | reason: ${billingReason}`);
}

