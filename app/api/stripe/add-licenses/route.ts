import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { LEGACY_STRIPE_PRICE_IDS } from "@/lib/stripe/config";
import type { BillingCycle } from "@/types/database";
import {
  assertSeatQuantity,
  getProPriceId,
  inferSubscriptionFromStripeItems,
  planTypeFromSeatCount,
  proPriceFields,
  totalSeatsFromLicenses,
} from "@/lib/stripe/pricing";
import { canDowngradeTo } from "@/lib/permissions";
import {
  increaseProSeatsWithImmediateInvoice,
  proSeatDbFields,
} from "@/lib/stripe/seatUpdates";

/**
 * POST /api/stripe/add-licenses
 *
 * Sets absolute seat quantity on the existing subscription (never += N).
 * Body: { targetSeatCount: number }
 *
 * Seat increases (Pro): pending_if_incomplete + always_invoice — quantity applies
 * only after successful payment; DB seats update only on success.
 * Seat decreases: update quantity with create_prorations; floor = 1 while paid.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    let targetSeatCount: number;
    try {
      if (body.targetSeatCount != null) {
        targetSeatCount = assertSeatQuantity(body.targetSeatCount);
      } else if (body.additionalLicensesToAdd != null) {
        targetSeatCount = -1;
      } else {
        return NextResponse.json({ error: "Missing targetSeatCount" }, { status: 400 });
      }
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    const { data: orgData } = await supabase.rpc("get_user_organization_membership", {
      p_user_id: user.id,
    });

    if (!orgData || orgData.length === 0) {
      return NextResponse.json({ error: "No organization found" }, { status: 404 });
    }

    const orgContext = orgData[0];
    if (orgContext.role !== "owner") {
      return NextResponse.json(
        { error: "Only the owner can manage licenses" },
        { status: 403 }
      );
    }

    const { data: subscription, error: subError } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("organization_id", orgContext.organization_id)
      .single();

    if (subError || !subscription) {
      return NextResponse.json({ error: "No subscription found" }, { status: 404 });
    }

    if (subscription.plan_type === "free" || !subscription.stripe_subscription_id) {
      return NextResponse.json(
        { error: "No active paid subscription. Upgrade to Pro first." },
        { status: 400 }
      );
    }

    const currentSeats = totalSeatsFromLicenses(
      subscription.base_licenses || 1,
      subscription.additional_licenses || 0
    );

    if (targetSeatCount < 0) {
      try {
        targetSeatCount = assertSeatQuantity(
          currentSeats + Number(body.additionalLicensesToAdd)
        );
      } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
    }

    if (targetSeatCount === currentSeats) {
      return NextResponse.json({
        success: true,
        message: "Seat count unchanged",
        targetSeatCount,
        subscription,
      });
    }

    const usedLicenses = orgContext.used_licenses || 1;
    const downgradeCheck = canDowngradeTo(
      planTypeFromSeatCount(targetSeatCount),
      usedLicenses,
      targetSeatCount
    );
    if (!downgradeCheck.allowed) {
      return NextResponse.json({ error: downgradeCheck.reason }, { status: 400 });
    }

    const billingCycle = (subscription.billing_cycle || "yearly") as BillingCycle;
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripe_subscription_id,
      { expand: ["items"] }
    );
    const inferred = inferSubscriptionFromStripeItems(stripeSubscription.items.data);

    try {
      // ——— Pro seat INCREASE: pending update + immediate proration invoice ———
      if (inferred.isPro && targetSeatCount > currentSeats) {
        const result = await increaseProSeatsWithImmediateInvoice({
          stripeSubscriptionId: subscription.stripe_subscription_id,
          billingCycle,
          previousSeatCount: currentSeats,
          targetSeatCount,
          metadata: {
            organization_id: orgContext.organization_id,
            user_id: user.id,
          },
        });

        if (!result.ok) {
          console.log(
            `[update-seats] ❌ pro increase pending/failed | ${currentSeats} → ${targetSeatCount} | reason: ${result.reason} | pi: ${result.paymentIntentStatus}`
          );
          return NextResponse.json(
            {
              success: false,
              error: result.message,
              reason: result.reason,
              requiresAction: result.reason === "requires_action",
              pendingUpdate: result.pendingUpdate,
              clientSecret: result.clientSecret,
              paymentIntentStatus: result.paymentIntentStatus,
              invoiceId: result.invoiceId,
              invoiceStatus: result.invoiceStatus,
              previousSeatCount: currentSeats,
              targetSeatCount,
              // Seats were NOT granted
              seatsGranted: false,
            },
            { status: result.reason === "requires_action" ? 402 : 402 }
          );
        }

        const fields = proSeatDbFields(billingCycle, targetSeatCount);
        let proPriceId: string;
        try {
          proPriceId = getProPriceId(billingCycle);
        } catch {
          proPriceId = result.subscription.items.data[0]?.price.id || "";
        }

        const { data: dbSub, error: updateError } = await supabase
          .from("subscriptions")
          .update({
            ...fields,
            stripe_price_id: proPriceId,
            status: result.subscription.status === "active" ? "active" : subscription.status,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", orgContext.organization_id)
          .select()
          .single();

        if (updateError) {
          console.error("Failed to update database after successful seat payment:", updateError);
        }

        console.log(
          `[update-seats] ✅ pro increase paid | ${currentSeats} → ${targetSeatCount} | invoice: ${result.invoiceId}`
        );

        return NextResponse.json({
          success: true,
          message: `Seat count set to ${targetSeatCount}. Prorated charge collected.`,
          targetSeatCount,
          previousSeatCount: currentSeats,
          seatsGranted: true,
          invoiceId: result.invoiceId,
          paymentIntentStatus: result.paymentIntentStatus,
          subscription: dbSub,
          stripeSubscriptionId: result.subscription.id,
        });
      }

      // ——— Pro seat DECREASE (or same-path legacy handling below) ———
      if (inferred.isPro && targetSeatCount < currentSeats) {
        let proPriceId: string;
        try {
          proPriceId = getProPriceId(billingCycle);
        } catch (envErr: any) {
          return NextResponse.json({ error: envErr.message }, { status: 500 });
        }

        const proItem = stripeSubscription.items.data.find(
          (item) => item.price.id === inferred.priceId || item.price.id === proPriceId
        );
        if (!proItem) {
          return NextResponse.json({ error: "Pro subscription item not found" }, { status: 400 });
        }

        const updatedSubscription = await stripe.subscriptions.update(
          stripeSubscription.id,
          {
            items: [{ id: proItem.id, quantity: targetSeatCount }],
            proration_behavior: "create_prorations",
            metadata: {
              ...stripeSubscription.metadata,
              plan_type: planTypeFromSeatCount(targetSeatCount),
              seat_count: String(targetSeatCount),
              seat_change: "decrease",
              product: "pro",
              billing_cycle: billingCycle,
            },
          }
        );

        const fields = proPriceFields(billingCycle, targetSeatCount);
        const { data: dbSub, error: updateError } = await supabase
          .from("subscriptions")
          .update({
            ...fields,
            stripe_price_id: proPriceId,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", orgContext.organization_id)
          .select()
          .single();

        if (updateError) console.error("Failed to update database:", updateError);

        console.log(
          `[update-seats] ✅ pro decrease | ${currentSeats} → ${targetSeatCount}`
        );

        return NextResponse.json({
          success: true,
          message: `Seat count set to ${targetSeatCount}`,
          targetSeatCount,
          previousSeatCount: currentSeats,
          seatsGranted: true,
          subscription: dbSub,
          stripeSubscriptionId: updatedSubscription.id,
        });
      }

      // Grandfathered legacy org
      if (inferred.isLegacy && inferred.planType === "organization") {
        if (targetSeatCount < 2) {
          return NextResponse.json(
            {
              error:
                "Legacy Organization plans include 2 base seats. To move to 1 seat, switch to the new Pro plan from Billing.",
            },
            { status: 400 }
          );
        }

        const additionalQty = targetSeatCount - 2;
        const licensePriceId =
          billingCycle === "monthly"
            ? LEGACY_STRIPE_PRICE_IDS.organization.additionalLicense.monthly
            : LEGACY_STRIPE_PRICE_IDS.organization.additionalLicense.yearly;

        const licenseItem = stripeSubscription.items.data.find(
          (item) => item.price.id === licensePriceId
        );

        const items: Array<{ id?: string; price?: string; quantity?: number; deleted?: boolean }> =
          [];

        if (additionalQty === 0 && licenseItem) {
          items.push({ id: licenseItem.id, deleted: true });
        } else if (licenseItem) {
          items.push({ id: licenseItem.id, quantity: additionalQty });
        } else if (additionalQty > 0) {
          items.push({ price: licensePriceId, quantity: additionalQty });
        }

        if (items.length === 0) {
          return NextResponse.json({
            success: true,
            message: "Seat count unchanged",
            targetSeatCount,
          });
        }

        const isIncrease = targetSeatCount > currentSeats;
        const updatedSubscription = await stripe.subscriptions.update(stripeSubscription.id, {
          items,
          proration_behavior: isIncrease ? "always_invoice" : "create_prorations",
          ...(isIncrease ? { payment_behavior: "pending_if_incomplete" as const } : {}),
          expand: isIncrease ? ["latest_invoice.payment_intent"] : undefined,
        });

        if (isIncrease && updatedSubscription.pending_update) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Payment for the prorated license increase failed or requires action. No additional seats were granted.",
              reason: "payment_failed",
              pendingUpdate: true,
              seatsGranted: false,
              previousSeatCount: currentSeats,
              targetSeatCount,
            },
            { status: 402 }
          );
        }

        const { data: dbSub, error: updateError } = await supabase
          .from("subscriptions")
          .update({
            base_licenses: 2,
            additional_licenses: additionalQty,
            plan_type: "organization",
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", orgContext.organization_id)
          .select()
          .single();

        if (updateError) console.error("Failed to update database:", updateError);

        return NextResponse.json({
          success: true,
          message: `Seat count set to ${targetSeatCount}`,
          targetSeatCount,
          previousSeatCount: currentSeats,
          seatsGranted: true,
          subscription: dbSub,
          stripeSubscriptionId: updatedSubscription.id,
        });
      }

      if (inferred.isLegacy && inferred.planType === "individual" && targetSeatCount > 1) {
        return NextResponse.json(
          {
            error:
              "To add seats, upgrade to the current Pro plan from Billing. Your legacy Single User price will be replaced with Pro ($20/user/mo).",
            requiresProCheckout: true,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: "Unable to update seats for this subscription type" },
        { status: 400 }
      );
    } catch (stripeError: any) {
      console.error("Failed to update Stripe subscription:", stripeError);
      // Stripe often throws on incomplete payment with certain API modes
      const code = stripeError?.code || stripeError?.raw?.code;
      if (
        code === "subscription_payment_incomplete" ||
        stripeError?.message?.includes("payment") ||
        stripeError?.type === "StripeCardError"
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              stripeError.message ||
              "Payment for the prorated license increase failed. No additional seats were granted.",
            reason: "payment_failed",
            seatsGranted: false,
            previousSeatCount: currentSeats,
            targetSeatCount,
          },
          { status: 402 }
        );
      }
      return NextResponse.json(
        { error: stripeError.message || "Failed to update subscription in Stripe" },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("Update seats error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update seats" },
      { status: 500 }
    );
  }
}
