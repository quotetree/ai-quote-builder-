# Individual Plan Auto-Charge Fix

## Issue
When a trial user with a payment method tries to switch from Individual Monthly to Individual Yearly (or vice versa), they get redirected to Stripe Checkout instead of being charged automatically on their card on file.

## Root Cause Analysis

In `/app/api/stripe/checkout/route.ts`, there are two paths for upgrading a trial:

### Path 1: Trial WITHOUT Stripe Subscription (Line 118)
```typescript
if (existingSubscription && 
    existingSubscription.status === "trialing" && 
    !existingSubscription.stripe_subscription_id &&  // NO Stripe subscription yet
    customerId) {
  // Creates Stripe subscription directly, charges card ✅
}
```
**This works**: Creates subscription in Stripe, charges card, updates database.

### Path 2: Trial WITH Stripe Subscription (Line 208)
```typescript
if (existingSubscription?.stripe_subscription_id && !forceCheckout) {
  // Updates existing Stripe subscription ✅
}
```
**This should work**: Updates the existing Stripe subscription with new pricing.

### Path 3: Fallback - Redirect to Checkout (Line 539)
```typescript
// No active subscription OR unauthenticated user - create new checkout session
```
**This is the problem**: Users are falling through to this case.

## The Problem

When a user creates an Individual Monthly trial with a payment method:
- They go through Stripe checkout
- Stripe creates a subscription in `trialing` status  
- Database has: `plan_type='individual'`, `billing_cycle='monthly'`, `status='trialing'`, `stripe_subscription_id='sub_xxx'`

When they try to switch to Individual Yearly:
- Line 118 is FALSE (they DO have stripe_subscription_id)
- Line 208 should be TRUE and should work...

**BUT**: If the user's subscription doesn't have a `stripe_subscription_id` in the database (even though they have a payment method), they fall through to the checkout redirect.

## The Fix

We need to ensure that when a trialing user with a payment method changes their plan (Individual Monthly ↔ Yearly), we:

1. Check if they have a payment method (customerId)
2. If they do, create/update the Stripe subscription and charge them
3. End the trial and activate the subscription

The fix is to expand the condition on line 118 to also handle plan changes within the Individual tier during trial.

## Solution

Update the condition to handle BOTH cases:
- Trial users without Stripe subscription (original case)
- Trial users changing Individual plan variants (new case)

```typescript
// Line 116-204: Expand to handle Individual plan changes during trial
if (existingSubscription && existingSubscription.status === "trialing" && customerId) {
  // Case 1: No Stripe subscription yet (original)
  // Case 2: Switching between Individual Monthly/Yearly during trial (NEW)
  const isIndividualPlanChange = 
    existingSubscription.plan_type === 'individual' && 
    planType === 'individual' &&
    existingSubscription.billing_cycle !== billingCycle;
  
  if (!existingSubscription.stripe_subscription_id || isIndividualPlanChange) {
    console.log("Trial user - creating/updating subscription directly");
    // ... create or update subscription logic
  }
}
```

This ensures trial users with payment methods get charged directly when changing Individual plan variants, matching the behavior of Organization plan changes.

