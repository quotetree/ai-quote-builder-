import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import type { BillingCycle } from "@/types/database";
import { PLAN_PRICING } from "@/types/database";
import {
  assertSeatQuantity,
  getProPriceId,
  planTypeFromSeatCount,
  proMonthlyEquivalentCents,
  totalSeatsFromLicenses,
} from "@/lib/stripe/pricing";

/**
 * POST /api/stripe/preview-proration
 *
 * Body: { billingCycle, seatCount }
 * Used especially for monthly ↔ annual switches before commit.
 * Seat-only changes use Stripe standard proration (create_prorations) on apply.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const billingCycle = body.billingCycle as BillingCycle;

    if (billingCycle !== "monthly" && billingCycle !== "yearly") {
      return NextResponse.json({ error: "Invalid billingCycle" }, { status: 400 });
    }

    let seatCount: number;
    try {
      if (body.seatCount != null) {
        seatCount = assertSeatQuantity(body.seatCount);
      } else if (body.planType === "organization") {
        seatCount = assertSeatQuantity(2 + (body.additionalLicenses || 0));
      } else {
        seatCount = assertSeatQuantity(body.additionalLicenses != null ? 1 + body.additionalLicenses : 1);
      }
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    const { data: orgData } = await supabase.rpc("get_user_organization_membership", {
      p_user_id: user.id,
    });
    const organizationId = orgData?.[0]?.organization_id;

    if (!organizationId) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const { data: currentSubscription } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("organization_id", organizationId)
      .single();

    if (!currentSubscription?.stripe_subscription_id) {
      // Free → paid: no proration, full charge at checkout
      const total =
        billingCycle === "monthly"
          ? PLAN_PRICING.pro.monthlyPerSeatCents * seatCount
          : PLAN_PRICING.pro.yearlyPerSeatCents * seatCount;
      return NextResponse.json({
        prorationAmount: total,
        isUpgrade: true,
        requiresCheckout: true,
        scheduledForPeriodEnd: false,
        resetsBillingAnchor: true,
        effectiveDate: new Date().toISOString(),
        currentPlanDescription: "Free",
        newPlanDescription: formatProDescription(billingCycle, seatCount),
        billingMessage: `You'll be charged ${formatCurrency(total)} to start Pro.`,
      });
    }

    const currentSeats = totalSeatsFromLicenses(
      currentSubscription.base_licenses || 1,
      currentSubscription.additional_licenses || 0
    );
    const currentCycle = (currentSubscription.billing_cycle || "monthly") as BillingCycle;
    const newPlanType = planTypeFromSeatCount(seatCount);

    const currentMonthly = proMonthlyEquivalentCents(currentCycle, currentSeats);
    const newMonthly = proMonthlyEquivalentCents(billingCycle, seatCount);
    const cycleChanged = currentCycle !== billingCycle;
    const seatsChanged = currentSeats !== seatCount;

    let prorationAmount = 0;
    let requiresCheckout = true;
    let isUpgrade = newMonthly > currentMonthly;
    let scheduledForPeriodEnd = false;
    let resetsBillingAnchor = false;
    let billingMessage = "";

    // Try Stripe upcoming invoice preview when possible
    try {
      const priceId = getProPriceId(billingCycle);
      const stripeSub = await stripe.subscriptions.retrieve(
        currentSubscription.stripe_subscription_id,
        { expand: ["items"] }
      );
      const itemId = stripeSub.items.data[0]?.id;

      if (itemId) {
        const upcoming = await stripe.invoices.createPreview({
          customer: stripeSub.customer as string,
          subscription: stripeSub.id,
          subscription_details: {
            items: [
              {
                id: itemId,
                price: priceId,
                quantity: seatCount,
              },
            ],
            proration_behavior: "create_prorations",
          },
        });
        prorationAmount = upcoming.amount_due;
      }
    } catch (previewErr: any) {
      console.warn("Stripe upcoming invoice preview failed:", previewErr.message);
      // Fallback estimate
      if (billingCycle === "yearly" && currentCycle === "monthly") {
        prorationAmount = PLAN_PRICING.pro.yearlyPerSeatCents * seatCount;
      } else if (seatsChanged && !cycleChanged) {
        const perSeat =
          billingCycle === "monthly"
            ? PLAN_PRICING.pro.monthlyPerSeatCents
            : PLAN_PRICING.pro.yearlyPerSeatCents;
        prorationAmount = Math.max(0, (seatCount - currentSeats) * perSeat);
      }
    }

    if (cycleChanged) {
      resetsBillingAnchor = true;
      requiresCheckout = true;
      scheduledForPeriodEnd = false;
      isUpgrade =
        currentCycle === "monthly" && billingCycle === "yearly"
          ? true
          : newMonthly >= currentMonthly;
      if (currentCycle === "yearly" && billingCycle === "monthly" && newMonthly <= currentMonthly) {
        // Treat yearly → monthly as scheduled downgrade unless seats increase enough
        if (newMonthly < currentMonthly) {
          scheduledForPeriodEnd = true;
          requiresCheckout = false;
          prorationAmount = 0;
          billingMessage = `Your plan will switch to monthly on ${formatDate(currentSubscription.current_period_end)}.`;
        } else {
          billingMessage = `Preview: estimated charge ${formatCurrency(prorationAmount)} when switching to monthly with ${seatCount} seat(s).`;
        }
      } else {
        billingMessage = `Preview: estimated charge ${formatCurrency(prorationAmount)} when switching to ${billingCycle} billing with ${seatCount} seat(s). Confirm to apply.`;
      }
    } else if (seatsChanged) {
      // Same cycle seat change — standard proration on apply
      isUpgrade = seatCount > currentSeats;
      scheduledForPeriodEnd = false;
      requiresCheckout = true;
      resetsBillingAnchor = false;
      billingMessage = isUpgrade
        ? `Adding seats to ${seatCount}. Estimated prorated charge today: ${formatCurrency(prorationAmount)}.`
        : `Reducing seats to ${seatCount}. Estimated prorated adjustment today: ${formatCurrency(prorationAmount)}.`;
    } else {
      billingMessage = "No changes needed.";
      requiresCheckout = false;
      prorationAmount = 0;
    }

    return NextResponse.json({
      prorationAmount,
      isUpgrade,
      requiresCheckout,
      scheduledForPeriodEnd,
      resetsBillingAnchor,
      effectiveDate: scheduledForPeriodEnd
        ? currentSubscription.current_period_end
        : new Date().toISOString(),
      currentPlanDescription: formatProDescription(currentCycle, currentSeats),
      newPlanDescription: formatProDescription(billingCycle, seatCount),
      currentPeriodEnd: currentSubscription.current_period_end,
      billingMessage,
      seatCount,
      planType: newPlanType,
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
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "your next renewal date";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "your next renewal date";
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatProDescription(billingCycle: BillingCycle, seatCount: number): string {
  const cycleText = billingCycle === "monthly" ? "Monthly" : "Annual";
  const account = planTypeFromSeatCount(seatCount) === "organization" ? "Organization" : "Individual";
  if (billingCycle === "monthly") {
    const total = (PLAN_PRICING.pro.monthlyPerSeatCents * seatCount) / 100;
    return `Pro ${account} · ${seatCount} seat${seatCount === 1 ? "" : "s"} · ${cycleText} ($${total}/mo)`;
  }
  const total = (PLAN_PRICING.pro.yearlyPerSeatCents * seatCount) / 100;
  return `Pro ${account} · ${seatCount} seat${seatCount === 1 ? "" : "s"} · ${cycleText} ($${total}/yr)`;
}
