# In-App Payment Testing Guide

## Overview
Subscription upgrades now process payments **in-app** using the card on file, without redirecting to Stripe Checkout. This provides a much smoother UX while maintaining security.

## What Changed

### Before
- All upgrades redirected to Stripe Checkout
- Users left the app to complete payment
- Redirect back to app after payment

### After
- Upgrades charge the card on file via Stripe Subscription Update API
- Users stay in the app during the entire process
- Instant feedback with loading and success states
- Only first-time purchases redirect to Checkout (when no card on file)

## How It Works

### For Existing Subscriptions (Upgrades)
1. User selects new plan
2. Proration preview modal shows charge amount
3. User clicks "Confirm Change"
4. Loading state: "Processing payment..."
5. Backend calls `stripe.subscriptions.update()` with:
   - Monthly upgrades: `proration_behavior: 'none'`, `billing_cycle_anchor: 'now'`
   - Yearly upgrades: `proration_behavior: 'always_invoice'`
6. **Stripe automatically charges the default payment method**
7. Success toast: "Plan upgraded successfully! Payment processed."
8. UI refreshes to show new plan

### For Existing Subscriptions (Downgrades)
1. User selects lower plan
2. Preview shows: "Your plan will change on [renewal date]"
3. User clicks "Confirm Change"
4. Downgrade scheduled in database (`pending_plan_change`)
5. Stripe subscription set to `cancel_at_period_end: true`
6. Success toast: "Downgrade scheduled successfully!"
7. Banner shows pending downgrade with option to cancel

### For First-Time Purchases (Free Trial → Paid)
- **Still redirects to Stripe Checkout** (no card on file yet)
- This is the only scenario that uses Checkout redirect

## Testing Scenarios

### 1. Upgrade Individual Monthly → Individual Yearly
**Expected:**
- Preview shows: "You'll be charged $948.00 for a full year today. Your billing date will reset to today. Next renewal: [date 1 year from now]."
- After confirm: No redirect, stays in app
- Success toast appears
- Plan updates immediately
- Card charged $948

### 2. Upgrade Organization Yearly (2 licenses) → Organization Yearly (5 licenses)
**Expected:**
- Preview shows prorated charge for remaining days
- After confirm: No redirect, stays in app
- Success toast appears
- License count updates immediately
- Card charged prorated amount

### 3. Downgrade Organization Monthly → Individual Monthly
**Expected:**
- Preview shows: "Your plan will change on [renewal date]."
- After confirm: No redirect, stays in app
- Success toast: "Downgrade scheduled successfully!"
- Banner appears showing pending downgrade
- No charge today, plan stays active until period end

### 4. First-Time Purchase (Free Trial → Individual Monthly)
**Expected:**
- Preview shows charge amount
- After confirm: **Redirects to Stripe Checkout** (no card on file)
- User enters card details
- Redirects back to app after payment
- Plan activates

## Technical Details

### Code Changes
**File:** `components/BillingModal.tsx` (lines 227-269)
- Removed `forceCheckout: true` logic
- Always passes `false` for `forceCheckout` parameter
- Simplified to handle `scheduled`, `updated`, or `url` responses

### Stripe Behavior
When we call `stripe.subscriptions.update()`:
- Stripe checks the customer's default payment method
- Automatically creates an invoice
- Charges the card immediately (for upgrades)
- No user interaction required (card already on file)

### Error Handling
If payment fails:
- Stripe webhook sends `invoice.payment_failed` event
- User sees error toast with reason
- Subscription remains on old plan
- No partial state changes

## Benefits

1. **Better UX**: Users stay in the app, no context switching
2. **Faster**: No page loads or redirects
3. **Clearer**: Loading states and immediate feedback
4. **Secure**: Uses Stripe's automatic billing (PCI compliant)
5. **Reliable**: Webhooks ensure database consistency

## Notes

- The checkout route logic (`app/api/stripe/checkout/route.ts`) already supported this - we just removed the frontend logic that was forcing redirects
- First-time purchases still need Checkout (to collect card details)
- All payment processing happens server-side via Stripe
- Card details never touch our servers

