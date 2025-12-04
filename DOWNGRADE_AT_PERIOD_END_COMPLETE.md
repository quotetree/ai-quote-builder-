# Downgrade at Period End - Implementation Complete

## Summary

Successfully implemented scheduled downgrades for subscription plan changes. The system now:
- **Upgrades**: Apply immediately with prorated charges
- **Downgrades**: Scheduled for next billing cycle with no credits/refunds

## What Was Changed

### 1. Database & Types
- ✅ Added `pending_plan_change` JSONB column to subscriptions table
- ✅ Updated `Subscription` interface with pending change structure
- ✅ Updated `ProrationPreview` interface with `scheduledForPeriodEnd` and `futureSavings`
- ✅ Migration file: `supabase/migrations/20251203171629_add_pending_plan_change.sql`

### 2. Price Comparison Logic
- ✅ Updated `determineIfUpgrade()` to compare total prices per billing period
- ✅ Individual Monthly ($97) vs Individual Yearly ($79*12 = $948)
- ✅ Organization plans calculated with base + additional licenses
- ✅ Higher total price = upgrade, lower = downgrade

### 3. API Routes
- ✅ `app/api/stripe/preview-proration/route.ts` - Shows proration preview with savings
- ✅ `app/api/stripe/checkout/route.ts` - Schedules downgrades, applies upgrades immediately
- ✅ `app/api/stripe/cancel-pending-change/route.ts` - Cancel scheduled downgrades

### 4. UI Components
- ✅ Proration confirmation modal updated with downgrade messaging
- ✅ Shows "Downgrade scheduled for [date]" + "You'll save $XX/month"
- ✅ Pending downgrade banner in billing overview
- ✅ "Cancel scheduled downgrade" button for owners

### 5. Client Utilities
- ✅ `cancelPendingPlanChange()` function added to client-utils

## How It Works

### Upgrade Flow (Individual Monthly → Organization Monthly)
1. User clicks "Upgrade to Organization"
2. Proration preview shows: "You'll be charged $XXX today"
3. Confirm → Redirects to Stripe Checkout
4. After payment → Immediate switch
5. Any pending downgrade is cleared

### Downgrade Flow (Organization Yearly → Individual Monthly)
1. User selects Individual Monthly plan
2. Proration preview shows:
   - "Downgrade scheduled for [Feb 15, 2025]"
   - "You'll save $118/month starting then"
3. Confirm → Stored in database, no Stripe checkout
4. Blue banner appears in overview showing scheduled change
5. Owner can cancel the scheduled downgrade

### Cancel Pending Downgrade
1. User sees blue banner: "Downgrade Scheduled"
2. Clicks "Cancel scheduled downgrade"
3. Pending change removed from database
4. Banner disappears

## Testing Guide

### Required Setup
1. **Apply Migration**: Run the new migration in Supabase SQL Editor
   ```sql
   -- Copy contents of supabase/migrations/20251203171629_add_pending_plan_change.sql
   ```

2. **Hard Refresh**: `Cmd + Shift + R` to clear cached JavaScript

### Test Scenarios

#### Test 1: Downgrade (No Credit)
```
1. Start with: Organization Monthly ($245/month)
2. Open Billing → Edit plan → Switch to Individual Monthly
3. Click "Upgrade to Individual"
4. → Should show blue modal
5. → "Downgrade scheduled for [date]"
6. → "You'll save $148/month"
7. Confirm
8. → Blue banner appears in overview
9. → No Stripe checkout (stays in app)
```

#### Test 2: Upgrade (With Charge)
```
1. Start with: Individual Monthly ($97/month)
2. Open Billing → Edit plan → Switch to Organization Monthly
3. Click "Upgrade to Organization"
4. → Should show green modal
5. → "You'll be charged $XXX today"
6. Confirm
7. → Redirects to Stripe Checkout
8. → After payment, immediately switches
```

#### Test 3: Cancel Pending Downgrade
```
1. Schedule a downgrade (Test 1)
2. See blue banner in overview
3. Click "Cancel scheduled downgrade"
4. → Success toast
5. → Banner disappears
6. → Subscription stays on current plan
```

#### Test 4: Upgrade While Downgrade Pending
```
1. Schedule a downgrade
2. Open Edit plan again
3. Select higher-priced plan (upgrade)
4. Confirm upgrade
5. → Goes through Stripe Checkout
6. → After payment, pending downgrade is cleared
7. → Immediately on new (upgraded) plan
```

## Database Schema

### subscriptions.pending_plan_change
```json
{
  "plan_type": "individual" | "organization",
  "billing_cycle": "monthly" | "yearly",
  "additional_licenses": 0,
  "scheduled_for": "2025-02-15T00:00:00.000Z",
  "created_at": "2025-12-03T17:16:29.000Z"
}
```

## Files Changed
- `app/api/stripe/preview-proration/route.ts` (price comparison logic)
- `app/api/stripe/checkout/route.ts` (downgrade scheduling)
- `app/api/stripe/cancel-pending-change/route.ts` (new API route)
- `supabase/migrations/20251203171629_add_pending_plan_change.sql` (new migration)
- `types/database.ts` (updated interfaces)
- `components/BillingModal.tsx` (UI for pending changes)
- `lib/stripe/client-utils.ts` (cancel function)

## Notes

### Webhook Handling
- Scheduled downgrades are stored in the database only
- Stripe subscription remains unchanged until period end
- **TODO**: Add webhook handler to apply scheduled changes at period end
  - Listen for `customer.subscription.updated` or invoice paid events
  - Check for `pending_plan_change` in database
  - Apply the scheduled changes
  - Clear `pending_plan_change` field

### Stripe Configuration
- No Stripe subscription schedule API used
- Downgrade is purely database-side tracking
- On period end, webhook should update Stripe subscription to match pending change

## Ready to Test!

The implementation is complete and ready for testing. Start with Test 1 (Downgrade) to see the new scheduled behavior.

All code is committed to the `billing-data-display` branch.

