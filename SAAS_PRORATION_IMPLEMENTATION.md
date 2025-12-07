# SaaS Proration Implementation

## Overview
This document describes the implementation of true SaaS-style proration logic for subscription license upgrades in QuoteTree.ai.

## Problem Statement
Previously, when a user added licenses to their organization plan (e.g., 2 → 3 licenses), the system would:
- ❌ Reset the billing cycle anchor to today
- ❌ Charge the full new monthly/yearly amount immediately
- ❌ Change the renewal date to today

This is not how modern SaaS billing should work.

## Solution
The new implementation follows industry-standard SaaS proration:

### When Adding Licenses
1. **Keep billing cycle anchor unchanged** - renewal date stays the same
2. **Charge only prorated amount** - calculate the cost for new licenses based on remaining days in current cycle
3. **Full amount at renewal** - on the existing renewal date, charge the new total (license_count × seat_price)

### Example Scenario
- **Current:** 2 licenses @ $79/mo = $158/month
- **User adds 1 license mid-cycle (15 days remaining out of 30)**
- **Immediate charge:** $79 × (15/30) ≈ $39.50
- **Next renewal:** $237/month (3 licenses @ $79)
- **Renewal date:** Unchanged from original subscription start date

## Implementation Details

### 1. Proration Preview API (`/app/api/stripe/preview-proration/route.ts`)

Added "Branch 0" logic to detect license-only changes:

```typescript
// Check if this is a license quantity change ONLY
const isLicenseOnlyChange = (
  currentPlan === newPlan &&
  currentCycle === newCycle &&
  currentPlan === "organization" &&
  currentLicenses !== newLicenses
);

if (isLicenseOnlyChange && newLicenses > currentLicenses) {
  // Calculate proration based on remaining days
  const licenseDiff = newLicenses - currentLicenses;
  const pricePerLicensePerCycle = currentCycle === "monthly" 
    ? PLAN_PRICING.organization[currentCycle].perAdditionalLicense 
    : PLAN_PRICING.organization[currentCycle].perAdditionalLicense * 12;
  
  const totalDays = Math.ceil((currentPeriodEnd - currentPeriodStart) / (1000 * 60 * 60 * 24));
  const remainingDays = Math.max(1, Math.ceil((currentPeriodEnd - now) / (1000 * 60 * 60 * 24)));
  const remainingFraction = totalDays > 0 ? remainingDays / totalDays : 1;
  
  prorationAmount = Math.round((pricePerLicensePerCycle * licenseDiff) * remainingFraction);
  resetsBillingAnchor = false; // KEEP the billing anchor
}
```

**Key Points:**
- Calculates remaining fraction of billing period
- Charges only for the new licenses (not entire subscription)
- Keeps `resetsBillingAnchor = false` to preserve renewal date
- Provides clear billing message to user

### 2. Subscription Update API (`/app/api/stripe/checkout/route.ts`)

Modified the subscription update logic to handle license-only changes differently:

```typescript
// Check if this is a license-only change
const isLicenseOnlyChange = (
  existingSubscription.plan_type === planType &&
  currentCycle === billingCycle &&
  planType === "organization" &&
  currentAdditionalLicenses !== additionalLicenses
);

if (isLicenseOnlyChange) {
  // Update quantity on existing license line item (don't delete/recreate)
  stripeSubscription.items.data.forEach((item: any) => {
    if (item.price.id === licensePriceId) {
      itemUpdates.push({
        id: item.id,
        quantity: additionalLicenses,
      });
    }
  });
  
  // Use proper proration behavior
  prorationBehavior = "create_prorations";
  billingCycleAnchor = "unchanged"; // CRITICAL: Keep existing anchor
}
```

**Key Changes:**
- Detects license-only changes (same plan type, same cycle)
- Updates existing subscription item quantity instead of deleting/recreating
- Uses `proration_behavior: "create_prorations"` to let Stripe calculate proration
- Uses `billing_cycle_anchor: "unchanged"` to preserve renewal date

### 3. User Interface

The BillingModal already displays the proration preview messages. The new messages will show:

**For license additions:**
```
"You'll be charged a prorated amount of $39.50 today for 1 additional license 
(15 days remaining in current period). Next billing date remains January 6, 2026 
— renewal will be $237/month."
```

**For license removals (downgrades):**
```
"1 license will be removed on January 6, 2026."
```

## Proration Rules

### License Changes (Same Plan, Same Cycle)
| Change Type | Immediate Charge | Billing Anchor | Next Renewal Amount |
|-------------|------------------|----------------|---------------------|
| Add licenses | Prorated for remaining period | **Unchanged** | New total (new qty × price) |
| Remove licenses | None (scheduled for period end) | **Unchanged** | New total (new qty × price) |

### Plan/Cycle Changes (Different Plan or Cycle)
| Change Type | Immediate Charge | Billing Anchor | Behavior |
|-------------|------------------|----------------|----------|
| Monthly → Yearly | Full year charge | **Reset to today** | Commitment upgrade |
| Yearly → Monthly | None (scheduled) | **Unchanged until change** | Downgrade at period end |
| Monthly → Monthly (plan change) | Full new month | **Reset to today** | Plan upgrade |
| Yearly → Yearly (plan change) | Prorated difference | **Unchanged** | Upgrade within commitment |

## Stripe API Usage

### Proration Behavior Options
- `"create_prorations"` - Stripe calculates and creates prorated charges/credits automatically
- `"always_invoice"` - Always create an invoice for the difference
- `"none"` - No proration, charge full new amount

### Billing Cycle Anchor
- `"unchanged"` - Keep existing renewal date (used for license-only changes)
- `"now"` - Reset renewal date to today (used for plan/cycle changes)

## Testing Guide

### Test Case 1: Add 1 License to Monthly Plan
1. Start with 2-license organization monthly plan ($158/month)
2. Add 1 license mid-cycle (e.g., 15 days into 30-day cycle)
3. **Expected:**
   - Preview shows prorated charge ≈ $39.50
   - Immediate invoice for $39.50
   - Next renewal date unchanged
   - Next renewal amount = $237

### Test Case 2: Add 2 Licenses to Yearly Plan
1. Start with 2-license organization yearly plan ($130/month = $1560/year)
2. Add 2 licenses mid-year (e.g., 180 days into 365-day cycle)
3. **Expected:**
   - Preview shows prorated charge ≈ $64 (2 licenses × $65/mo × (180/365) × 12 months)
   - Immediate invoice for prorated amount
   - Next renewal date unchanged
   - Next renewal amount = $3,900/year (4 licenses @ $65/mo × 12)

### Test Case 3: Remove 1 License
1. Start with 3-license organization plan
2. Remove 1 license
3. **Expected:**
   - No immediate charge
   - Change scheduled for period end
   - Preview shows "1 license will be removed on [renewal date]"

### Test Case 4: Plan Type Change (still charges full)
1. Start with Individual monthly plan
2. Switch to Organization monthly plan with 1 additional license
3. **Expected:**
   - Immediate charge for full new month amount
   - Billing anchor resets to today
   - This is a plan type change, not just a license change

## Technical Notes

### Why `create_prorations` Instead of Manual Calculation?
We calculate and show the prorated amount in the preview for user transparency, but we let Stripe handle the actual proration when updating the subscription. This ensures:
- Accurate to-the-second proration
- Proper invoice line items
- Automatic credit for unused time (if applicable)
- Stripe's proration engine handles edge cases

### Edge Cases Handled
1. **Invalid period dates** - Falls back to charging full period for new licenses
2. **Same-day changes** - Minimum 1 day proration to avoid $0 charges
3. **Removing all additional licenses** - Properly deletes the license line item
4. **Adding first license** - Creates new line item if none exists

## Files Modified

1. **`/app/api/stripe/preview-proration/route.ts`**
   - Added Branch 0 for license-only changes
   - Proration calculation logic
   - User-friendly billing messages

2. **`/app/api/stripe/checkout/route.ts`**
   - License-only change detection
   - Item update logic (update quantity vs delete/recreate)
   - Proration behavior configuration
   - Billing cycle anchor preservation

3. **`/components/BillingModal.tsx`**
   - Already displays proration preview messages correctly
   - No changes needed (messages come from API)

## Deployment Notes

1. This is a **backward-compatible** change
2. Existing subscriptions continue to work normally
3. New logic only applies to organization plan license changes
4. All other upgrade/downgrade flows remain unchanged

## Future Enhancements

Potential improvements:
1. **Downgrade proration credits** - Currently downgrades wait until period end; could add immediate credits
2. **Mid-cycle plan changes** - Could add proration for Individual → Organization changes
3. **Proration preview improvements** - Show exact invoice line items in preview
4. **Email notifications** - Send confirmation email with proration details

## Stripe Dashboard Verification

To verify proper behavior in Stripe Dashboard:
1. Go to Subscriptions → [Subscription ID]
2. Check "Schedule" tab - should show no upcoming changes for license additions
3. Check "Invoices" - should see prorated invoice immediately
4. Verify billing cycle anchor date hasn't changed
5. Check next invoice preview - should show new total amount

## Monitoring & Alerting

Key metrics to monitor:
- Proration amount accuracy (compare preview to actual charge)
- Billing anchor changes (should not change for license-only)
- Invoice creation timing (should be immediate)
- Customer complaints about unexpected billing date changes (should decrease)

---

**Implementation Date:** December 6, 2025  
**Branch:** `feature/saas-proration-logic`  
**Status:** ✅ Complete

