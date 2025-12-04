import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { STRIPE_PRICE_IDS } from "@/lib/stripe/config";
import type { PlanType, BillingCycle } from "@/types/database";
import { PLAN_PRICING } from "@/types/database";

// Helper: Get price per period (monthly equivalent)
function getPricePerPeriod(planType: PlanType, billingCycle: BillingCycle, additionalLicenses: number = 0): number {
  if (planType === "individual") {
    return billingCycle === "monthly" ? 97 : 79; // per month
  } else {
    const base = billingCycle === "monthly" ? 245 : 197; // per month
    const licenseRate = billingCycle === "monthly" ? 79 : 65; // per license per month
    return base + (additionalLicenses * licenseRate);
  }
}

// Helper: Get total charge for the billing period (in cents)
function getTotalCharge(planType: PlanType, billingCycle: BillingCycle, additionalLicenses: number = 0): number {
  if (planType === "individual") {
    return billingCycle === "monthly" ? 9700 : 94800; // $97 or $948
  } else {
    const base = billingCycle === "monthly" ? 24500 : 236400; // $245 or $2,364
    const licenseRate = billingCycle === "monthly" ? 7900 : 78000; // $79/mo or $780/yr per license
    return base + (additionalLicenses * licenseRate);
  }
}

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

    const currentPlan = currentSubscription.plan_type;
    const currentCycle = currentSubscription.billing_cycle;
    const currentLicenses = currentSubscription.additional_licenses || 0;
    const newPlan = planType;
    const newCycle = billingCycle;
    const newLicenses = additionalLicenses;

    const currentPricePerPeriod = getPricePerPeriod(currentPlan, currentCycle, currentLicenses);
    const newPricePerPeriod = getPricePerPeriod(newPlan, newCycle, newLicenses);
    const currentTotalCharge = getTotalCharge(currentPlan, currentCycle, currentLicenses);
    const newTotalCharge = getTotalCharge(newPlan, newCycle, newLicenses);

    const currentPlanDescription = formatPlanDescription(currentPlan, currentCycle, currentLicenses);
    const newPlanDescription = formatPlanDescription(newPlan, newCycle, newLicenses);

    let prorationAmount = 0;
    let requiresCheckout = false;
    let isUpgrade = false;
    let scheduledForPeriodEnd = false;
    let billingMessage = "";
    let resetsBillingAnchor = false;

    // Branch 1: Monthly → Yearly (always upgrade, charge full year)
    if (currentCycle === "monthly" && newCycle === "yearly") {
      prorationAmount = newTotalCharge;
      requiresCheckout = true;
      isUpgrade = true;
      scheduledForPeriodEnd = false;
      resetsBillingAnchor = true;
      const nextRenewal = new Date();
      nextRenewal.setFullYear(nextRenewal.getFullYear() + 1);
      billingMessage = `You'll be charged ${formatCurrency(newTotalCharge)} for a full year today. Your billing date will reset to today. Next renewal: ${formatDate(nextRenewal.toISOString())}.`;
    }
    // Branch 2: Yearly → Monthly (always downgrade, schedule for period end)
    else if (currentCycle === "yearly" && newCycle === "monthly") {
      prorationAmount = 0;
      requiresCheckout = false;
      isUpgrade = false;
      scheduledForPeriodEnd = true;
      const changeDate = currentSubscription.current_period_end || "your next renewal date";
      billingMessage = `Your plan will change on ${formatDate(changeDate)}.`;
    }
    // Branch 3: Monthly → Monthly
    else if (currentCycle === "monthly" && newCycle === "monthly") {
      if (newPricePerPeriod > currentPricePerPeriod) {
        // Monthly upgrade
        prorationAmount = newTotalCharge;
        requiresCheckout = true;
        isUpgrade = true;
        scheduledForPeriodEnd = false;
        resetsBillingAnchor = true;
        const nextRenewal = new Date();
        nextRenewal.setMonth(nextRenewal.getMonth() + 1);
        billingMessage = `You'll be charged ${formatCurrency(newTotalCharge)} for the new monthly rate today. Your billing date will reset to today. Next renewal: ${formatDate(nextRenewal.toISOString())}.`;
      } else {
        // Monthly downgrade
        prorationAmount = 0;
        requiresCheckout = false;
        isUpgrade = false;
        scheduledForPeriodEnd = true;
        const changeDate = currentSubscription.current_period_end || "your next renewal date";
        billingMessage = `Your plan will change on ${formatDate(changeDate)}.`;
      }
    }
    // Branch 4: Yearly → Yearly
    else if (currentCycle === "yearly" && newCycle === "yearly") {
      if (newPricePerPeriod > currentPricePerPeriod) {
        // Yearly upgrade - calculate prorated difference
        const priceDiff = newTotalCharge - currentTotalCharge;
        
        // Check if we have valid period dates
        if (currentSubscription.current_period_start && currentSubscription.current_period_end) {
          const currentPeriodStart = new Date(currentSubscription.current_period_start);
          const currentPeriodEnd = new Date(currentSubscription.current_period_end);
          const now = new Date();
          
          // Validate dates
          if (!isNaN(currentPeriodStart.getTime()) && !isNaN(currentPeriodEnd.getTime())) {
            const totalDays = Math.ceil((currentPeriodEnd.getTime() - currentPeriodStart.getTime()) / (1000 * 60 * 60 * 24));
            const remainingDays = Math.max(1, Math.ceil((currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
            const remainingFraction = totalDays > 0 ? remainingDays / totalDays : 1;
            
            prorationAmount = Math.max(0, Math.round(priceDiff * remainingFraction));
            requiresCheckout = true;
            isUpgrade = true;
            scheduledForPeriodEnd = false;
            resetsBillingAnchor = false;
            billingMessage = `You'll be charged ${formatCurrency(prorationAmount)} today (prorated for ${remainingDays} days remaining). Your renewal date stays ${formatDate(currentSubscription.current_period_end)}.`;
          } else {
            // Invalid dates - charge full difference
            prorationAmount = priceDiff;
            requiresCheckout = true;
            isUpgrade = true;
            scheduledForPeriodEnd = false;
            resetsBillingAnchor = false;
            billingMessage = `You'll be charged ${formatCurrency(prorationAmount)} today for the upgrade.`;
          }
        } else {
          // No period dates - charge full difference
          prorationAmount = priceDiff;
          requiresCheckout = true;
          isUpgrade = true;
          scheduledForPeriodEnd = false;
          resetsBillingAnchor = false;
          billingMessage = `You'll be charged ${formatCurrency(prorationAmount)} today for the upgrade.`;
        }
      } else {
        // Yearly downgrade
        prorationAmount = 0;
        requiresCheckout = false;
        isUpgrade = false;
        scheduledForPeriodEnd = true;
        const changeDate = currentSubscription.current_period_end || "your next renewal date";
        billingMessage = `Your plan will change on ${formatDate(changeDate)}.`;
      }
    }

    return NextResponse.json({
      prorationAmount,
      isUpgrade,
      requiresCheckout,
      scheduledForPeriodEnd,
      resetsBillingAnchor,
      effectiveDate: scheduledForPeriodEnd ? currentSubscription.current_period_end : new Date().toISOString(),
      currentPlanDescription,
      newPlanDescription,
      currentPeriodEnd: currentSubscription.current_period_end,
      billingMessage,
    });
  } catch (error: any) {
    console.error("Proration preview error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to preview changes" },
      { status: 500 }
    );
  }
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(dateString: string | null): string {
  if (!dateString || dateString === "your next renewal date") return "your next renewal date";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "your next renewal date";
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
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
    const base = billingCycle === "monthly" ? 245 : 197;
    const licenseRate = billingCycle === "monthly" ? 79 : 65;
    const total = base + (additionalLicenses * licenseRate);
    return `Organization ${cycleText} ($${total}/month)`;
  }
}

