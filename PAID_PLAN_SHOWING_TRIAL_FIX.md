# Fix: Paid Plan Incorrectly Showing as Trial

## Problem

When purchasing an Organization or Individual plan directly from the landing page (without a free trial), the subscription was incorrectly displaying as "Free Trial Active" in the billing UI, even though:
- The user had paid for the plan
- The next billing date was correctly set 30 days out
- The subscription was active and working

## Root Cause

The issue occurred due to the sequence of events when a new user purchases from the landing page:

1. **User completes checkout** → Stripe `checkout.session.completed` webhook fires
2. **Webhook creates user account** (line 184 in `app/api/webhooks/stripe/route.ts`) via Supabase Auth
3. **Database trigger fires** (`handle_new_user()` in `supabase/profiles-trigger.sql`) which automatically creates:
   - Profile
   - Organization
   - **Free trial subscription** with `trial_start_date` and `trial_end_date` set (14 days)
4. **Webhook tries to update subscription** to the paid plan (lines 323-349)
5. **❌ BUG**: The update query didn't clear or override the trial dates, so the subscription had:
   - `plan_type`: "organization" (correct)
   - `status`: "active" (correct)
   - `trial_start_date`: still set from free trial (WRONG)
   - `trial_end_date`: still set from free trial (WRONG)

## The Fix

### 1. Webhook Update (`app/api/webhooks/stripe/route.ts`)

Updated the subscription update query to:
- Get trial dates from the Stripe subscription object
- Set `trial_start_date` and `trial_end_date` to null if Stripe says there's no trial
- Use the actual Stripe subscription status instead of hardcoding "active"

```typescript
// Before
status: "active",
// No trial_start_date or trial_end_date fields

// After
status: stripeSubscription.status || "active",
trial_start_date: stripeSubscription.trial_start
  ? new Date(stripeSubscription.trial_start * 1000).toISOString()
  : null,
trial_end_date: stripeSubscription.trial_end
  ? new Date(stripeSubscription.trial_end * 1000).toISOString()
  : null,
```

**Why this works:**
- When a user purchases without a trial, Stripe's `subscription.trial_start` and `subscription.trial_end` are `null`
- This now correctly clears the trial dates that were set by the `handle_new_user()` trigger
- If a user DOES purchase with a trial (like the Free Trial card), Stripe's trial dates will be saved correctly

### 2. UI Reverted (`components/BillingModal.tsx`)

Reverted the UI changes since the root cause is now fixed in the webhook. The billing UI now correctly shows:
- **For paid plans without trial**: "Organization" or "Individual", no trial banner
- **For free trials**: "Free Trial" with trial banner
- **For paid plans WITH a trial period**: Shows trial banner with days remaining

## Testing

### For Paid Plans (No Trial)
1. Purchase Organization or Individual plan from landing page
2. Complete Stripe checkout
3. Billing UI should show:
   - Plan: "Organization" or "Individual" (NOT "Free Trial")
   - No trial banner
   - Next billing date 30 days out

### For Free Trial
1. Click "Start 14-Day Trial" from landing page
2. Complete Stripe checkout
3. Billing UI should show:
   - Plan: "Free Trial"
   - Trial banner with 14 days remaining
   - "Billed after trial ends"

## Files Modified

1. ✅ `app/api/webhooks/stripe/route.ts` - Added trial date handling
2. ✅ `components/BillingModal.tsx` - Reverted to original logic

## What's Fixed

- ✅ Paid plans no longer show "Free Trial Active"
- ✅ Trial dates are correctly cleared for non-trial purchases
- ✅ Trial dates are correctly set for trial purchases
- ✅ Subscription status comes from Stripe (not hardcoded)
- ✅ Billing UI accurately reflects subscription state

## Next Steps

After deploying this fix, existing subscriptions with incorrect trial dates will self-correct on their next Stripe webhook event (e.g., invoice payment, subscription update).

If you need to immediately fix existing subscriptions, run:

```sql
-- Clear trial dates for active paid subscriptions that shouldn't have trials
UPDATE subscriptions
SET 
  trial_start_date = NULL,
  trial_end_date = NULL,
  updated_at = NOW()
WHERE 
  plan_type IN ('individual', 'organization')
  AND status = 'active'
  AND trial_end_date IS NOT NULL;
```

