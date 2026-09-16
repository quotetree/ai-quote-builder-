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

/**
 * POST /api/stripe/add-licenses
 *
 * Sets absolute seat quantity on the existing subscription (never += N).
 * Body: { targetSeatCount: number }
 *
 * Proration: Stripe standard create_prorations for both increases and decreases.
 * Floor: targetSeatCount >= 1 while paid remains active.
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
        // Legacy delta API — convert to absolute using current seats (less safe; prefer targetSeatCount)
        // Resolved after we load subscription below
        targetSeatCount = -1;
      } else {
        return NextResponse.json(
          { error: "Missing targetSeatCount" },
          { status: 400 }
        );
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

    // Block reducing below active member count
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
      let updatedSubscription;

      if (inferred.isPro) {
        let proPriceId: string;
        try {
          proPriceId = getProPriceId(billingCycle);
        } catch (envErr: any) {
          return NextResponse.json({ error: envErr.message }, { status: 500 });
        }

        const proItem = stripeSubscription.items.data.find(
          (item) => item.price.id === inferred.priceId || item.price.id === proPriceId
        );

        const items = proItem
          ? [{ id: proItem.id, price: proPriceId, quantity: targetSeatCount }]
          : [{ price: proPriceId, quantity: targetSeatCount }];

        // Delete stray items if any
        const itemUpdates = [
          ...stripeSubscription.items.data
            .filter((item) => !proItem || item.id !== proItem.id)
            .map((item) => ({ id: item.id, deleted: true as const })),
          ...items,
        ];

        updatedSubscription = await stripe.subscriptions.update(stripeSubscription.id, {
          items: itemUpdates,
          // Standard proration for both increases and decreases
          proration_behavior: "create_prorations",
          metadata: {
            ...stripeSubscription.metadata,
            plan_type: planTypeFromSeatCount(targetSeatCount),
            seat_count: String(targetSeatCount),
            product: "pro",
            billing_cycle: billingCycle,
          },
        });

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

        if (updateError) {
          console.error("Failed to update database:", updateError);
        }

        console.log(
          `[update-seats] ✅ pro | ${currentSeats} → ${targetSeatCount} | plan: ${fields.plan_type}`
        );

        return NextResponse.json({
          success: true,
          message: `Seat count set to ${targetSeatCount}`,
          targetSeatCount,
          previousSeatCount: currentSeats,
          subscription: dbSub,
          stripeSubscriptionId: updatedSubscription.id,
        });
      }

      // Grandfathered legacy org: set absolute quantity on additional-license line item
      // Legacy base = 2 seats; additional licenses = targetSeatCount - 2
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

        updatedSubscription = await stripe.subscriptions.update(stripeSubscription.id, {
          items,
          proration_behavior: "create_prorations",
        });

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

        console.log(
          `[update-seats] ✅ legacy-org | ${currentSeats} → ${targetSeatCount}`
        );

        return NextResponse.json({
          success: true,
          message: `Seat count set to ${targetSeatCount}`,
          targetSeatCount,
          previousSeatCount: currentSeats,
          subscription: dbSub,
          stripeSubscriptionId: updatedSubscription.id,
        });
      }

      // Legacy individual wanting more seats → require moving to Pro via checkout
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
