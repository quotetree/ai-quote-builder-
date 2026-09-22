import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import type { BillingCycle } from "@/types/database";
import { PLAN_PRICING } from "@/types/database";
import type Stripe from "stripe";
import {
  assertSeatQuantity,
  getProPriceId,
  inferSubscriptionFromStripeItems,
  planTypeFromSeatCount,
  proMonthlyEquivalentCents,
  totalSeatsFromLicenses,
} from "@/lib/stripe/pricing";

/**
 * POST /api/stripe/preview-proration
 *
 * Body: { billingCycle, seatCount }
 * Previews the immediate charge for plan/seat changes.
 * Seat increases use the same proration as apply: always_invoice + remaining period.
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
        seatCount = assertSeatQuantity(
          body.additionalLicenses != null ? 1 + body.additionalLicenses : 1
        );
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
    let remainingDays: number | null = null;
    let previewSource: "stripe" | "day_fraction" | "none" = "none";

    // Stripe period dates are authoritative for remaining-days math
    let periodStartMs: number | null = null;
    let periodEndMs: number | null = null;

    try {
      const priceId = getProPriceId(billingCycle);
      const stripeSub = await stripe.subscriptions.retrieve(
        currentSubscription.stripe_subscription_id,
        { expand: ["items.data.price"] }
      );
      const inferred = inferSubscriptionFromStripeItems(stripeSub.items.data);
      const proItem =
        stripeSub.items.data.find((item) =>
          inferred.priceId ? item.price.id === inferred.priceId : false
        ) ||
        stripeSub.items.data.find((item) => item.price.id === priceId) ||
        stripeSub.items.data[0];

      // Stripe API 2025+: billing period lives on subscription items, not the subscription
      const itemPeriod = proItem as Stripe.SubscriptionItem & {
        current_period_start?: number;
        current_period_end?: number;
      };
      const subLegacy = stripeSub as Stripe.Subscription & {
        current_period_start?: number;
        current_period_end?: number;
      };

      periodStartMs = itemPeriod?.current_period_start
        ? itemPeriod.current_period_start * 1000
        : subLegacy.current_period_start
          ? subLegacy.current_period_start * 1000
          : currentSubscription.current_period_start
            ? new Date(currentSubscription.current_period_start).getTime()
            : null;
      periodEndMs = itemPeriod?.current_period_end
        ? itemPeriod.current_period_end * 1000
        : subLegacy.current_period_end
          ? subLegacy.current_period_end * 1000
          : currentSubscription.current_period_end
            ? new Date(currentSubscription.current_period_end).getTime()
            : null;

      if (periodStartMs && periodEndMs && periodEndMs > Date.now()) {
        remainingDays = Math.max(
          1,
          Math.ceil((periodEndMs - Date.now()) / (1000 * 60 * 60 * 24))
        );
      }

      if (proItem) {
        const prorationDate = Math.floor(Date.now() / 1000);
        // Match apply path: always_invoice so preview is the immediate charge invoice
        const upcoming = await stripe.invoices.createPreview({
          customer: stripeSub.customer as string,
          subscription: stripeSub.id,
          subscription_details: {
            items: [
              {
                id: proItem.id,
                price: priceId,
                quantity: seatCount,
              },
            ],
            proration_behavior: "always_invoice",
            proration_date: prorationDate,
          },
          expand: ["lines.data"],
        });

        const prorationOnly = sumProrationLineAmounts(upcoming);
        // Prefer proration-only lines (Stripe-recommended). Fall back to amount_due
        // only when there are no identifiable proration lines.
        if (prorationOnly !== null) {
          prorationAmount = Math.max(0, prorationOnly);
          previewSource = "stripe";
        } else if (typeof upcoming.amount_due === "number") {
          prorationAmount = Math.max(0, upcoming.amount_due);
          previewSource = "stripe";
        }

        console.log(
          `[preview-proration] stripe | seats ${currentSeats}→${seatCount} | prorations=${prorationOnly} | amount_due=${upcoming.amount_due} | remainingDays=${remainingDays} | periodEnd=${periodEndMs ? new Date(periodEndMs).toISOString() : null}`
        );
      }
    } catch (previewErr: any) {
      console.warn(
        "[preview-proration] Stripe createPreview failed:",
        previewErr?.message || previewErr
      );
    }

    // Day-fraction fallback (and correction when Stripe returned a full-seat
    // amount that ignores remaining period — common if preview mis-scoped).
    if (seatsChanged && !cycleChanged && seatCount > currentSeats) {
      const dayEstimate = estimateSeatIncreaseProrationCents({
        billingCycle,
        seatDiff: seatCount - currentSeats,
        periodStartMs,
        periodEndMs,
        dbPeriodStart: currentSubscription.current_period_start,
        dbPeriodEnd: currentSubscription.current_period_end,
      });

      if (previewSource !== "stripe") {
        prorationAmount = dayEstimate.amountCents;
        remainingDays = dayEstimate.remainingDays;
        previewSource = "day_fraction";
      } else if (
        dayEstimate.amountCents > 0 &&
        // If Stripe amount equals a full unprorated seat * diff, but we still
        // have a meaningful fraction of the period left, prefer day math.
        isLikelyUnproratedFullSeatCharge(
          prorationAmount,
          seatCount - currentSeats,
          billingCycle
        ) &&
        dayEstimate.remainingFraction < 0.95
      ) {
        console.warn(
          `[preview-proration] correcting full-seat Stripe amount ${prorationAmount} → day estimate ${dayEstimate.amountCents} (fraction=${dayEstimate.remainingFraction.toFixed(3)})`
        );
        prorationAmount = dayEstimate.amountCents;
        remainingDays = dayEstimate.remainingDays;
        previewSource = "day_fraction";
      }
    } else if (previewSource !== "stripe" && seatsChanged && !cycleChanged && seatCount < currentSeats) {
      // Decreases: no immediate charge in our model
      prorationAmount = 0;
    } else if (previewSource !== "stripe" && cycleChanged && billingCycle === "yearly" && currentCycle === "monthly") {
      prorationAmount = PLAN_PRICING.pro.yearlyPerSeatCents * seatCount;
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
      isUpgrade = seatCount > currentSeats;
      scheduledForPeriodEnd = false;
      requiresCheckout = isUpgrade;
      resetsBillingAnchor = false;
      if (isUpgrade) {
        const daysNote =
          remainingDays != null
            ? ` for the remaining ${remainingDays} day${remainingDays === 1 ? "" : "s"} in your billing period`
            : "";
        billingMessage = `Adding seats to ${seatCount}. Estimated prorated charge today: ${formatCurrency(prorationAmount)}${daysNote}.`;
      } else {
        billingMessage = `Reducing seats to ${seatCount}. No charge today — quantity updates immediately; unused time is credited on your next invoice when applicable.`;
      }
    } else {
      billingMessage = "No changes needed.";
      requiresCheckout = false;
      prorationAmount = 0;
    }

    console.log(
      `[preview-proration] ✅ done | ${currentSeats}→${seatCount} | amount=${prorationAmount} | source=${previewSource}`
    );

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
      remainingDays,
      previewSource,
    });
  } catch (error: any) {
    console.error("Proration preview error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to preview changes" },
      { status: 500 }
    );
  }
}

/** Sum only proration line items (Stripe-recommended for update previews). */
function sumProrationLineAmounts(invoice: Stripe.Invoice): number | null {
  const lines = invoice.lines?.data;
  if (!lines || lines.length === 0) return null;

  let sum = 0;
  let found = false;

  for (const line of lines) {
    const parent = (line as Stripe.InvoiceLineItem).parent;
    const fromSubscriptionItem =
      parent?.subscription_item_details?.proration === true;
    const fromInvoiceItem = parent?.invoice_item_details?.proration === true;
    // Legacy shape still present on some expansions
    const legacy = (line as Stripe.InvoiceLineItem & { proration?: boolean }).proration === true;

    if (fromSubscriptionItem || fromInvoiceItem || legacy) {
      found = true;
      sum += line.amount;
    }
  }

  return found ? sum : null;
}

function isLikelyUnproratedFullSeatCharge(
  amountCents: number,
  seatDiff: number,
  billingCycle: BillingCycle
): boolean {
  if (seatDiff <= 0) return false;
  const perSeat =
    billingCycle === "monthly"
      ? PLAN_PRICING.pro.monthlyPerSeatCents
      : PLAN_PRICING.pro.yearlyPerSeatCents;
  const full = perSeat * seatDiff;
  return Math.abs(amountCents - full) <= 1;
}

function estimateSeatIncreaseProrationCents(params: {
  billingCycle: BillingCycle;
  seatDiff: number;
  periodStartMs: number | null;
  periodEndMs: number | null;
  dbPeriodStart?: string | null;
  dbPeriodEnd?: string | null;
}): { amountCents: number; remainingDays: number | null; remainingFraction: number } {
  const perSeat =
    params.billingCycle === "monthly"
      ? PLAN_PRICING.pro.monthlyPerSeatCents
      : PLAN_PRICING.pro.yearlyPerSeatCents;

  let start = params.periodStartMs;
  let end = params.periodEndMs;

  if ((!start || !end) && params.dbPeriodStart && params.dbPeriodEnd) {
    const s = new Date(params.dbPeriodStart).getTime();
    const e = new Date(params.dbPeriodEnd).getTime();
    if (!isNaN(s) && !isNaN(e)) {
      start = s;
      end = e;
    }
  }

  if (!start || !end || end <= start) {
    return {
      amountCents: Math.max(0, perSeat * params.seatDiff),
      remainingDays: null,
      remainingFraction: 1,
    };
  }

  const now = Date.now();
  const totalMs = end - start;
  const remainingMs = Math.max(0, end - now);
  const remainingFraction = Math.min(1, Math.max(0, remainingMs / totalMs));
  const remainingDays = Math.max(1, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));

  return {
    amountCents: Math.round(perSeat * params.seatDiff * remainingFraction),
    remainingDays,
    remainingFraction,
  };
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
  const account =
    planTypeFromSeatCount(seatCount) === "organization" ? "Organization" : "Individual";
  if (billingCycle === "monthly") {
    const total = (PLAN_PRICING.pro.monthlyPerSeatCents * seatCount) / 100;
    return `Pro ${account} · ${seatCount} seat${seatCount === 1 ? "" : "s"} · ${cycleText} ($${total}/mo)`;
  }
  const total = (PLAN_PRICING.pro.yearlyPerSeatCents * seatCount) / 100;
  return `Pro ${account} · ${seatCount} seat${seatCount === 1 ? "" : "s"} · ${cycleText} ($${total}/yr)`;
}
