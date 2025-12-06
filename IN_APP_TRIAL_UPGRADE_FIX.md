# In-App Plan Upgrades from Trial - Implementation

## Problem
When users on a free trial (with a payment method on file) tried to upgrade to a paid plan, they were redirected to Stripe Checkout instead of having their card charged in-app.

## Root Cause
There were TWO issues:

### Issue 1: BillingModal forcing checkout for trials
In `components/BillingModal.tsx`, the `handleUpgradePlan` function had a special case that forced trial users to go through Stripe Checkout:

```typescript
if (subscription?.status === "trialing") {
  await createCheckoutSession(plan, cycle, additionalLicenses, true); // forceCheckout = true
  return;
}
```

### Issue 2: API not handling trial subscriptions without Stripe IDs
In `app/api/stripe/checkout/route.ts`, the upgrade logic only worked for subscriptions that already had a `stripe_subscription_id`. Trial users who signed up via the landing page have:
- ✅ `stripe_customer_id` (payment method on file)
- ❌ `stripe_subscription_id` (NULL - no active Stripe subscription yet)

The API would skip the in-app upgrade logic and fall through to creating a new checkout session.

## Solution

### Fix 1: Remove trial special case in BillingModal
Removed the special case for trial subscriptions. Now ALL subscriptions (including trials) go through the same flow:
1. Show proration preview
2. User confirms
3. Charge card via API
4. Update in-app

**File**: `components/BillingModal.tsx`
**Lines**: ~208-224

### Fix 2: Handle trial subscriptions without Stripe IDs
Added special logic in the checkout API to detect trial users with payment methods but no Stripe subscription:

**File**: `app/api/stripe/checkout/route.ts`
**Lines**: ~117-210

When detected, it:
1. Creates a NEW subscription in Stripe with their existing payment method
2. Charges the card immediately (no trial on the new subscription)
3. Updates the database with the new subscription ID
4. Returns success JSON (no redirect)

## Flow After Fix

### For Trial Users Upgrading:
1. User clicks "Upgrade" in Billing & Plans modal
2. Modal shows cost breakdown & proration preview
3. User clicks "Confirm"
4. API detects: Trial + has payment method + no Stripe subscription
5. Creates new Stripe subscription (charges card immediately)
6. Updates database: status → "active", adds stripe_subscription_id
7. Returns success, modal refreshes
8. ✅ User upgraded, no redirect!

### For Paid Users Upgrading:
1. Same flow, but API updates existing Stripe subscription
2. Prorates charges based on upgrade/downgrade
3. ✅ Seamless in-app experience

## Testing
1. Sign up for 14-day trial via landing page (enter card)
2. Log in, open Billing & Plans
3. Click upgrade to Individual or Organization
4. Confirm the upgrade
5. ✅ Card charged immediately, no Stripe redirect
6. ✅ Plan updates in real-time

## Files Changed
- `components/BillingModal.tsx` - Removed trial checkout redirect
- `app/api/stripe/checkout/route.ts` - Added trial upgrade handling

