import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { STRIPE_PRICE_IDS } from "@/lib/stripe/config";
import type { PlanType, BillingCycle } from "@/types/database";
import { PLAN_PRICING } from "@/types/database";

export async function POST(request: NextRequest) {
  try {
    // Runtime check for Stripe key
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const supabase = await createClient();

    // Verify authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const { planType, billingCycle, additionalLicenses = 0 } = await request.json() as {
      planType: PlanType;
      billingCycle: BillingCycle;
      additionalLicenses: number;
    };

    // Get organization ID
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

    // Get current subscription
    const { data: currentSubscription } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("organization_id", organizationId)
      .single();

    if (!currentSubscription?.stripe_subscription_id) {
      return NextResponse.json(
        { error: "No active subscription found" },
        { status: 404 }
      );
    }

    // Determine if this is an upgrade or downgrade
    const isUpgrade = determineIfUpgrade(
      currentSubscription.plan_type,
      currentSubscription.billing_cycle,
      currentSubscription.additional_licenses,
      planType,
      billingCycle,
      additionalLicenses
    );

    // Build the new subscription items for preview
    const items: any[] = [];

    if (planType === "individual") {
      const priceId =
        billingCycle === "monthly"
          ? STRIPE_PRICE_IDS.individual.monthly
          : STRIPE_PRICE_IDS.individual.yearly;
      items.push({ price: priceId, quantity: 1 });
    } else if (planType === "organization") {
      const basePriceId =
        billingCycle === "monthly"
          ? STRIPE_PRICE_IDS.organization.base.monthly
          : STRIPE_PRICE_IDS.organization.base.yearly;
      items.push({ price: basePriceId, quantity: 1 });

      if (additionalLicenses > 0) {
        const licensePriceId =
          billingCycle === "monthly"
            ? STRIPE_PRICE_IDS.organization.additionalLicense.monthly
            : STRIPE_PRICE_IDS.organization.additionalLicense.yearly;
        items.push({ price: licensePriceId, quantity: additionalLicenses });
      }
    }

    // Preview the upcoming invoice with the changes
    try {
      const upcomingInvoice = await stripe.invoices.retrieveUpcoming({
        customer: currentSubscription.stripe_customer_id || undefined,
        subscription: currentSubscription.stripe_subscription_id,
        subscription_items: items.map((item, index) => ({
          id: index === 0 ? undefined : undefined, // Will be replaced by Stripe
          price: item.price,
          quantity: item.quantity,
        })),
        subscription_proration_behavior: "always_invoice",
      } as any);

      // Calculate the proration amount (can be positive for charge or negative for credit)
      const prorationAmount = upcomingInvoice.amount_due || 0;

      // Get plan descriptions
      const currentPlanDescription = formatPlanDescription(
        currentSubscription.plan_type,
        currentSubscription.billing_cycle,
        currentSubscription.additional_licenses
      );

      const newPlanDescription = formatPlanDescription(
        planType,
        billingCycle,
        additionalLicenses
      );

      // Determine effective date
      const effectiveDate = new Date().toISOString();

      // Determine if we need to go through checkout (for upgrades requiring payment)
      const requiresCheckout = isUpgrade && prorationAmount > 0;

      return NextResponse.json({
        prorationAmount,
        isUpgrade,
        requiresCheckout,
        effectiveDate,
        currentPlanDescription,
        newPlanDescription,
        currentPeriodEnd: currentSubscription.current_period_end,
      });
    } catch (invoiceError: any) {
      console.error("Failed to preview invoice:", invoiceError);
      
      // Fallback calculation if Stripe preview fails
      const fallbackProration = calculateFallbackProration(
        currentSubscription,
        planType,
        billingCycle,
        additionalLicenses
      );

      return NextResponse.json(fallbackProration);
    }
  } catch (error: any) {
    console.error("Proration preview error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to preview changes" },
      { status: 500 }
    );
  }
}

function determineIfUpgrade(
  currentPlan: PlanType,
  currentCycle: BillingCycle,
  currentAdditionalLicenses: number,
  newPlan: PlanType,
  newCycle: BillingCycle,
  newAdditionalLicenses: number
): boolean {
  // Organization is higher tier than Individual
  if (currentPlan === "individual" && newPlan === "organization") {
    return true;
  }
  if (currentPlan === "organization" && newPlan === "individual") {
    return false;
  }

  // Same plan type - check licenses
  if (newAdditionalLicenses > currentAdditionalLicenses) {
    return true;
  }

  // Cycle changes are considered neutral (not upgrades)
  return false;
}

function formatPlanDescription(
  planType: PlanType,
  billingCycle: BillingCycle,
  additionalLicenses: number
): string {
  const cycleText = billingCycle === "monthly" ? "Monthly" : "Yearly";
  
  if (planType === "individual") {
    const price = billingCycle === "monthly" ? "$97" : "$79";
    return `Individual ${cycleText} (${price}/month)`;
  } else {
    const basePrice = billingCycle === "monthly" ? "$245" : "$197";
    const licenseText = additionalLicenses > 0 
      ? ` + ${additionalLicenses} additional license${additionalLicenses > 1 ? 's' : ''}`
      : '';
    return `Organization ${cycleText} (${basePrice}/month${licenseText})`;
  }
}

function calculateFallbackProration(
  currentSubscription: any,
  newPlanType: PlanType,
  newBillingCycle: BillingCycle,
  newAdditionalLicenses: number
) {
  // Calculate current plan cost
  let currentMonthlyCost = 0;
  if (currentSubscription.plan_type === "individual") {
    currentMonthlyCost = PLAN_PRICING.individual[currentSubscription.billing_cycle];
  } else {
    currentMonthlyCost = 
      PLAN_PRICING.organization[currentSubscription.billing_cycle].base +
      currentSubscription.additional_licenses * 
      PLAN_PRICING.organization[currentSubscription.billing_cycle].perAdditionalLicense;
  }

  // Calculate new plan cost
  let newMonthlyCost = 0;
  if (newPlanType === "individual") {
    newMonthlyCost = PLAN_PRICING.individual[newBillingCycle];
  } else {
    newMonthlyCost = 
      PLAN_PRICING.organization[newBillingCycle].base +
      newAdditionalLicenses * 
      PLAN_PRICING.organization[newBillingCycle].perAdditionalLicense;
  }

  // Simple proration estimate (actual Stripe calculation is more complex)
  const priceDifference = newMonthlyCost - currentMonthlyCost;
  
  const isUpgrade = determineIfUpgrade(
    currentSubscription.plan_type,
    currentSubscription.billing_cycle,
    currentSubscription.additional_licenses,
    newPlanType,
    newBillingCycle,
    newAdditionalLicenses
  );

  return {
    prorationAmount: Math.abs(priceDifference),
    isUpgrade,
    requiresCheckout: isUpgrade && priceDifference > 0,
    effectiveDate: new Date().toISOString(),
    currentPlanDescription: formatPlanDescription(
      currentSubscription.plan_type,
      currentSubscription.billing_cycle,
      currentSubscription.additional_licenses
    ),
    newPlanDescription: formatPlanDescription(
      newPlanType,
      newBillingCycle,
      newAdditionalLicenses
    ),
    currentPeriodEnd: currentSubscription.current_period_end,
  };
}

