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

    // Log current state for debugging
    console.log('Current license state:', {
      dbAdditionalLicenses: subscription.additional_licenses,
      stripeAdditionalLicenses: licenseItem?.quantity || 0,
      requestedToAdd: additionalLicensesToAdd,
    });

    try {
      console.log('Before update - Subscription items:', {
        subscriptionId: stripeSubscription.id,
        items: stripeSubscription.items.data.map(item => ({
          id: item.id,
          priceId: item.price.id,
          quantity: item.quantity
        }))
      });

      // Build items array for subscription update
      const items: Array<{ id?: string; price?: string; quantity?: number }> = stripeSubscription.items.data.map((item: any) => {
        if (item.price.id === licensePriceId) {
          // Update license item quantity
          const newQuantity = (item.quantity || 0) + additionalLicensesToAdd;
          console.log(`Updating license item from ${item.quantity} to ${newQuantity}`);
          return {
            id: item.id,
        quantity: newQuantity,
          };
        }
        // Keep other items unchanged
        return { id: item.id };
      });

      // If no license item exists yet, add it
      if (!licenseItem) {
        console.log(`Adding new license item with quantity ${additionalLicensesToAdd}`);
        items.push({
          price: licensePriceId,
          quantity: additionalLicensesToAdd,
        });
      }

      console.log('Updating subscription with items:', items);

      // Update subscription with immediate proration
      const updatedSubscription = await stripe.subscriptions.update(
        stripeSubscription.id,
        {
          items,
          proration_behavior: "create_prorations", // Create proration items immediately
        }
      );

      console.log('Subscription updated successfully');

      // Verify the update by retrieving the subscription again
      const verifySubscription = await stripe.subscriptions.retrieve(stripeSubscription.id);
      const verifyLicenseItem = verifySubscription.items.data.find(
        (item) => item.price.id === licensePriceId
      );
      console.log('After update - verified license count:', {
        additionalLicenses: verifyLicenseItem?.quantity || 0,
        baseLicenses: 2,
        totalLicenses: 2 + (verifyLicenseItem?.quantity || 0),
        expectedMonthlyRate: 158 + (79 * (verifyLicenseItem?.quantity || 0)),
      });

      // CRITICAL FIX: Get the upcoming invoice which contains the proration
      // Don't use invoices.list() - it returns old paid invoices
      console.log('Retrieving upcoming invoice with proration...');
      
      try {
        const upcomingInvoice = await stripe.invoices.retrieveUpcoming({
          subscription: stripeSubscription.id,
        });

        console.log('Upcoming invoice:', {
          id: upcomingInvoice.id || 'not-created-yet',
          status: upcomingInvoice.status || 'upcoming',
          amount_due: upcomingInvoice.amount_due,
          total: upcomingInvoice.total,
        });

        // If there are proration line items with positive amount, create and pay invoice
        const hasProration = upcomingInvoice.lines.data.some(
          (line: any) => line.proration && line.amount > 0
        );

        if (hasProration && upcomingInvoice.amount_due > 0) {
          console.log('Proration detected, creating and paying invoice immediately...');
          
          // Create an invoice from the upcoming invoice
          const invoice = await stripe.invoices.create({
            customer: stripeSubscription.customer as string,
            subscription: stripeSubscription.id,
            auto_advance: true, // Automatically finalize
          });

          console.log('Invoice created:', invoice.id);

          // Finalize the invoice
          const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
          console.log('Invoice finalized, status:', finalizedInvoice.status);

          // Pay the invoice immediately
          if (finalizedInvoice.status === 'open') {
            const paidInvoice = await stripe.invoices.pay(invoice.id);
            console.log('Invoice paid successfully! Amount:', paidInvoice.amount_paid / 100);
          }
        } else {
          console.log('No proration needed or amount is 0');
        }
      } catch (invoiceError: any) {
        console.error('Invoice handling error:', invoiceError.message);
        // Don't fail the whole request if invoice payment fails
        // The subscription update was successful
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

