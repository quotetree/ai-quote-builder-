import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { stripe } from "@/lib/stripe/client";
import { createServiceRoleClient } from "@/lib/supabase/server";
import Stripe from "stripe";
import { PLAN_PRICING } from "@/types/database";
import { STRIPE_PRICE_IDS } from "@/lib/stripe/config";

export async function POST(request: NextRequest) {
  // Runtime check for Stripe key
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
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
  const planType = session.metadata?.plan_type as "individual" | "organization";
  const billingCycle = session.metadata?.billing_cycle as "monthly" | "yearly";
  const additionalLicenses = parseInt(session.metadata?.additional_licenses || "0");
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
              redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
            }
          );
          
          if (resetError) {
            console.error('Failed to send password setup email:', resetError);
          } else {
            console.log('Password setup email sent to:', customerEmail);
          }
        } catch (emailError) {
          console.error('Error sending password setup email:', emailError);
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

  // Calculate licenses
  const baseLicenses = planType === "organization" ? PLAN_PRICING.organization.baseLicenses : 1;

  // Calculate price - ONLY store the base price, not additional licenses
  let basePriceCents = 0;
  if (planType === "individual") {
    basePriceCents = PLAN_PRICING.individual[billingCycle];
  } else {
    basePriceCents = PLAN_PRICING.organization[billingCycle].base;
  }

  // Update subscription in database
  const { data: updateData, error } = await supabase
    .from("subscriptions")
    .update({
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      plan_type: planType,
      billing_cycle: billingCycle,
      status: "active",
      base_licenses: baseLicenses,
      additional_licenses: additionalLicenses,
      // Remove total_licenses - it's a generated column
      base_price_cents: basePriceCents,
      additional_license_price_cents:
        planType === "organization"
          ? PLAN_PRICING.organization[billingCycle].perAdditionalLicense
          : 0,
      current_period_start: stripeSubscription.current_period_start
        ? new Date(stripeSubscription.current_period_start * 1000).toISOString()
        : null,
      current_period_end: stripeSubscription.current_period_end
        ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
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

  if (!organizationId) {
    console.error("Missing organization_id in subscription metadata");
    return;
  }

  // Determine plan details from subscription items
  const items = sub.items.data;
  let planType: "individual" | "organization" = "individual";
  let billingCycle: "monthly" | "yearly" = "monthly";
  let additionalLicenses = 0;

  // Determine billing cycle from the first item's price interval
  if (items.length > 0 && items[0].price) {
    billingCycle = items[0].price.recurring?.interval === "year" ? "yearly" : "monthly";
  }

  // Check if it's an organization plan by looking for multiple items or specific prices
  if (items.length > 1) {
    planType = "organization";
    // Second item is usually the additional licenses
    additionalLicenses = items[1]?.quantity || 0;
  } else if (items.length === 1) {
    // Check if the single item is an org base price
    const priceId = items[0].price?.id;
    if (priceId === STRIPE_PRICE_IDS.organization.base.monthly || 
        priceId === STRIPE_PRICE_IDS.organization.base.yearly) {
      planType = "organization";
    }
  }

  // If metadata has explicit plan info, use that instead (from checkout route)
  if (sub.metadata?.plan_type) {
    planType = sub.metadata.plan_type as "individual" | "organization";
  }
  if (sub.metadata?.billing_cycle) {
    billingCycle = sub.metadata.billing_cycle as "monthly" | "yearly";
  }

  const baseLicenses = planType === "organization" ? PLAN_PRICING.organization.baseLicenses : 1;

  // Calculate pricing based on plan type and billing cycle
  let basePriceCents = 0;
  if (planType === "individual") {
    basePriceCents = PLAN_PRICING.individual[billingCycle];
  } else {
    basePriceCents = PLAN_PRICING.organization[billingCycle].base;
  }
  const additionalLicensePriceCents = planType === "organization"
    ? PLAN_PRICING.organization[billingCycle].perAdditionalLicense
    : 0;

  // Safely handle timestamps
  const currentPeriodStart = sub.current_period_start
    ? new Date(sub.current_period_start * 1000).toISOString()
    : null;
  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  const updateData: any = {
    plan_type: planType,
    billing_cycle: billingCycle,
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    base_licenses: baseLicenses,
    additional_licenses: additionalLicenses,
    base_price_cents: basePriceCents,
    additional_license_price_cents: additionalLicensePriceCents,
    updated_at: new Date().toISOString(),
  };

  // Only add timestamps if they exist
  if (currentPeriodStart) updateData.current_period_start = currentPeriodStart;
  if (currentPeriodEnd) updateData.current_period_end = currentPeriodEnd;

  console.log("Updating subscription with data:", {
    stripe_subscription_id: subscription.id,
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

  console.log(`Subscription ${subscription.id} updated`, updatedData[0]);
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  supabase: any
) {
  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "canceled",
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id);

  if (error) {
    console.error("Failed to cancel subscription:", error);
    throw error;
  }

  console.log(`Subscription ${subscription.id} canceled`);
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice, supabase: any) {
  console.log(`Payment succeeded for invoice ${invoice.id}`);
  // You could add logic here to:
  // - Send receipt emails
  // - Update payment history
  // - Log the transaction
}

async function handlePaymentFailed(invoice: Stripe.Invoice, supabase: any) {
  // Type assertion to work around Stripe type issues
  const inv = invoice as any;
  const subscriptionId =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;

  if (!subscriptionId) return;

  // Update subscription status to reflect payment failure
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

  console.log(`Payment failed for subscription ${subscriptionId}`);
  // You could add logic here to:
  // - Send payment failure emails
  // - Notify the user
  // - Implement retry logic
}

