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

      // For downgrades: no checkout, no proration charge, scheduled for period end
      // For upgrades: checkout with immediate charge
      const scheduledForPeriodEnd = !isUpgrade;
      const requiresCheckout = isUpgrade && prorationAmount > 0;

      // Calculate monthly savings for downgrades
      const currentMonthlyCost = calculateMonthlyCost(
        currentSubscription.plan_type,
        currentSubscription.billing_cycle,
        currentSubscription.additional_licenses
      );
      const newMonthlyCost = calculateMonthlyCost(
        planType,
        billingCycle,
        additionalLicenses
      );
      const futureSavings = !isUpgrade ? currentMonthlyCost - newMonthlyCost : 0;

      return NextResponse.json({
        prorationAmount: isUpgrade ? prorationAmount : 0, // No charge for downgrades
        isUpgrade,
        requiresCheckout,
        scheduledForPeriodEnd,
        effectiveDate,
        currentPlanDescription,
        newPlanDescription,
        currentPeriodEnd: currentSubscription.current_period_end,
        futureSavings,
        nextBillingDate: currentSubscription.current_period_end,
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

function calculateMonthlyCost(
  planType: PlanType,
  billingCycle: BillingCycle,
  additionalLicenses: number
): number {
  if (planType === "individual") {
    return PLAN_PRICING.individual[billingCycle];
  } else {
    return (
      PLAN_PRICING.organization[billingCycle].base +
      additionalLicenses * PLAN_PRICING.organization[billingCycle].perAdditionalLicense
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
  // Calculate total price per billing period for current plan
  let currentTotalPrice = 0;
  if (currentPlan === "individual") {
    currentTotalPrice = PLAN_PRICING.individual[currentCycle];
    if (currentCycle === "yearly") {
      currentTotalPrice *= 12; // Convert to yearly total
    }
  } else {
    const baseCost = PLAN_PRICING.organization[currentCycle].base;
    const licenseCost = currentAdditionalLicenses * PLAN_PRICING.organization[currentCycle].perAdditionalLicense;
    currentTotalPrice = baseCost + licenseCost;
    if (currentCycle === "yearly") {
      currentTotalPrice *= 12; // Convert to yearly total
    }
  }

  // Calculate total price per billing period for new plan
  let newTotalPrice = 0;
  if (newPlan === "individual") {
    newTotalPrice = PLAN_PRICING.individual[newCycle];
    if (newCycle === "yearly") {
      newTotalPrice *= 12; // Convert to yearly total
    }
  } else {
    const baseCost = PLAN_PRICING.organization[newCycle].base;
    const licenseCost = newAdditionalLicenses * PLAN_PRICING.organization[newCycle].perAdditionalLicense;
    newTotalPrice = baseCost + licenseCost;
    if (newCycle === "yearly") {
      newTotalPrice *= 12; // Convert to yearly total
    }
  }

  // Upgrade if new price is higher than current price
  return newTotalPrice > currentTotalPrice;
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
  const isUpgrade = determineIfUpgrade(
    currentSubscription.plan_type,
    currentSubscription.billing_cycle,
    currentSubscription.additional_licenses,
    newPlanType,
    newBillingCycle,
    newAdditionalLicenses
  );

  // Calculate monthly costs
  const currentMonthlyCost = calculateMonthlyCost(
    currentSubscription.plan_type,
    currentSubscription.billing_cycle,
    currentSubscription.additional_licenses
  );
  
  const newMonthlyCost = calculateMonthlyCost(
    newPlanType,
    newBillingCycle,
    newAdditionalLicenses
  );

  const priceDifference = newMonthlyCost - currentMonthlyCost;
  const futureSavings = !isUpgrade ? currentMonthlyCost - newMonthlyCost : 0;
  const scheduledForPeriodEnd = !isUpgrade;

  return {
    prorationAmount: isUpgrade && priceDifference > 0 ? Math.abs(priceDifference) : 0,
    isUpgrade,
    requiresCheckout: isUpgrade && priceDifference > 0,
    scheduledForPeriodEnd,
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
    futureSavings,
    nextBillingDate: currentSubscription.current_period_end,
  };
}

