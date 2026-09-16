import type { BillingCycle, PlanType } from "@/types/database";
import { PLAN_PRICING } from "@/types/database";
import {
  getProPriceId,
  tryGetProPriceIds,
  LEGACY_STRIPE_PRICE_IDS,
  MAX_SEAT_COUNT,
} from "./config";

/** Account / plan_type label derived from paid seat count (not a separate product). */
export function planTypeFromSeatCount(seatCount: number): "individual" | "organization" {
  return seatCount >= 2 ? "organization" : "individual";
}

/** Validate absolute seat quantity for an active paid subscription. */
export function assertSeatQuantity(n: unknown): number {
  const seats = typeof n === "number" ? n : parseInt(String(n), 10);
  if (!Number.isFinite(seats) || !Number.isInteger(seats)) {
    throw new Error("Seat count must be an integer");
  }
  if (seats < 1) {
    throw new Error("Seat count must be at least 1 for an active paid subscription");
  }
  if (seats > MAX_SEAT_COUNT) {
    throw new Error(`Seat count cannot exceed ${MAX_SEAT_COUNT}`);
  }
  return seats;
}

/** Map total seats → DB license columns (generated total_licenses = base + additional). */
export function seatsToLicenseFields(seatCount: number): {
  base_licenses: number;
  additional_licenses: number;
} {
  const seats = assertSeatQuantity(seatCount);
  return {
    base_licenses: 1,
    additional_licenses: seats - 1,
  };
}

export function totalSeatsFromLicenses(
  baseLicenses: number,
  additionalLicenses: number
): number {
  return Math.max(1, (baseLicenses || 0) + (additionalLicenses || 0));
}

/** Display / DB price fields for new Pro subscriptions. */
export function proPriceFields(billingCycle: BillingCycle, seatCount: number) {
  const seats = assertSeatQuantity(seatCount);
  const perSeat =
    billingCycle === "monthly"
      ? PLAN_PRICING.pro.monthlyPerSeatCents
      : PLAN_PRICING.pro.yearlyPerSeatCents;
  return {
    ...seatsToLicenseFields(seats),
    base_price_cents: perSeat,
    additional_license_price_cents: perSeat,
    plan_type: planTypeFromSeatCount(seats) as PlanType,
  };
}

/** Monthly-equivalent cents for comparing upgrades (Pro model). */
export function proMonthlyEquivalentCents(
  billingCycle: BillingCycle,
  seatCount: number
): number {
  const seats = assertSeatQuantity(seatCount);
  if (billingCycle === "monthly") {
    return PLAN_PRICING.pro.monthlyPerSeatCents * seats;
  }
  // yearly: $192/seat/year → $16/seat/month displayed equivalent
  return PLAN_PRICING.pro.yearlyDisplayedMonthlyCents * seats;
}

export function formatProDisplayPrice(billingCycle: BillingCycle, seatCount: number) {
  const seats = Math.max(1, seatCount);
  if (billingCycle === "monthly") {
    const perSeat = PLAN_PRICING.pro.monthlyPerSeatCents / 100;
    return {
      perSeatLabel: `$${perSeat}/user/mo`,
      totalCents: PLAN_PRICING.pro.monthlyPerSeatCents * seats,
      totalLabel: `$${(PLAN_PRICING.pro.monthlyPerSeatCents * seats) / 100}/mo`,
    };
  }
  const displayedMonthly = PLAN_PRICING.pro.yearlyDisplayedMonthlyCents / 100;
  const yearlyTotal = PLAN_PRICING.pro.yearlyPerSeatCents * seats;
  return {
    perSeatLabel: `$${displayedMonthly}/user/mo`,
    totalCents: yearlyTotal,
    totalLabel: `$${yearlyTotal / 100}/yr`,
    yearlyTotalCents: yearlyTotal,
  };
}

export function isProPriceId(priceId: string | null | undefined): boolean {
  if (!priceId) return false;
  const pro = tryGetProPriceIds();
  return priceId === pro.monthly || priceId === pro.yearly;
}

export function isLegacyPriceId(priceId: string | null | undefined): boolean {
  if (!priceId) return false;
  const all = [
    LEGACY_STRIPE_PRICE_IDS.individual.monthly,
    LEGACY_STRIPE_PRICE_IDS.individual.yearly,
    LEGACY_STRIPE_PRICE_IDS.organization.base.monthly,
    LEGACY_STRIPE_PRICE_IDS.organization.base.yearly,
    LEGACY_STRIPE_PRICE_IDS.organization.additionalLicense.monthly,
    LEGACY_STRIPE_PRICE_IDS.organization.additionalLicense.yearly,
  ];
  return all.includes(priceId as (typeof all)[number]);
}

export function allKnownPriceIds(): string[] {
  const pro = tryGetProPriceIds();
  return [
    pro.monthly,
    pro.yearly,
    LEGACY_STRIPE_PRICE_IDS.individual.monthly,
    LEGACY_STRIPE_PRICE_IDS.individual.yearly,
    LEGACY_STRIPE_PRICE_IDS.organization.base.monthly,
    LEGACY_STRIPE_PRICE_IDS.organization.base.yearly,
    LEGACY_STRIPE_PRICE_IDS.organization.additionalLicense.monthly,
    LEGACY_STRIPE_PRICE_IDS.organization.additionalLicense.yearly,
  ].filter(Boolean) as string[];
}

/**
 * Infer seat count + plan from a Stripe subscription's items.
 * Supports Pro (single line, quantity = seats) and legacy individual/org shapes.
 */
export function inferSubscriptionFromStripeItems(
  items: Array<{ price?: { id?: string; recurring?: { interval?: string } | null } | null; quantity?: number | null }>
): {
  planType: "individual" | "organization";
  billingCycle: BillingCycle;
  seatCount: number;
  priceId: string | null;
  isPro: boolean;
  isLegacy: boolean;
} {
  const first = items[0];
  const billingCycle: BillingCycle =
    first?.price?.recurring?.interval === "year" ? "yearly" : "monthly";

  const pro = tryGetProPriceIds();
  const proItem = items.find(
    (i) => i.price?.id === pro.monthly || i.price?.id === pro.yearly
  );
  if (proItem) {
    const seatCount = Math.max(1, proItem.quantity || 1);
    return {
      planType: planTypeFromSeatCount(seatCount),
      billingCycle:
        proItem.price?.id === pro.yearly ? "yearly" : "monthly",
      seatCount,
      priceId: proItem.price?.id || null,
      isPro: true,
      isLegacy: false,
    };
  }

  const legacyBaseIds = [
    LEGACY_STRIPE_PRICE_IDS.organization.base.monthly,
    LEGACY_STRIPE_PRICE_IDS.organization.base.yearly,
  ];
  const legacyLicenseIds = [
    LEGACY_STRIPE_PRICE_IDS.organization.additionalLicense.monthly,
    LEGACY_STRIPE_PRICE_IDS.organization.additionalLicense.yearly,
  ];
  const legacyIndividualIds = [
    LEGACY_STRIPE_PRICE_IDS.individual.monthly,
    LEGACY_STRIPE_PRICE_IDS.individual.yearly,
  ];

  const baseItem = items.find((i) => i.price?.id && legacyBaseIds.includes(i.price.id as any));
  const licenseItem = items.find(
    (i) => i.price?.id && legacyLicenseIds.includes(i.price.id as any)
  );
  const individualItem = items.find(
    (i) => i.price?.id && legacyIndividualIds.includes(i.price.id as any)
  );

  if (baseItem) {
    const additional = licenseItem?.quantity || 0;
    // Legacy org: base includes 2 seats
    const seatCount = 2 + additional;
    return {
      planType: "organization",
      billingCycle:
        baseItem.price?.id === LEGACY_STRIPE_PRICE_IDS.organization.base.yearly
          ? "yearly"
          : "monthly",
      seatCount,
      priceId: baseItem.price?.id || null,
      isPro: false,
      isLegacy: true,
    };
  }

  if (individualItem) {
    return {
      planType: "individual",
      billingCycle:
        individualItem.price?.id === LEGACY_STRIPE_PRICE_IDS.individual.yearly
          ? "yearly"
          : "monthly",
      seatCount: 1,
      priceId: individualItem.price?.id || null,
      isPro: false,
      isLegacy: true,
    };
  }

  // Unknown shape — treat quantity as seats
  const seatCount = Math.max(1, first?.quantity || 1);
  return {
    planType: planTypeFromSeatCount(seatCount),
    billingCycle,
    seatCount,
    priceId: first?.price?.id || null,
    isPro: false,
    isLegacy: false,
  };
}

export { getProPriceId };
