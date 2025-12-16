# Webhook Pricing Diagnostic

## The Issue
New free trials created AFTER the pricing update still show $97 instead of $79 in the billing page.

## Root Cause Analysis

The webhook code at `/app/api/webhooks/stripe/route.ts` lines 302-307 and 435-440 correctly uses:
```typescript
basePriceCents = PLAN_PRICING.individual[billingCycle];
```

This SHOULD be pulling the new values (7900 for monthly, 6500 for yearly).

## Possible Causes

### 1. Webhook Endpoint Issue
Your **Stripe webhook might be pointing to production** instead of your local dev server.

**Check in Stripe Dashboard:**
- Go to Developers → Webhooks
- Check webhook URL - is it pointing to localhost:3004 or production?
- For local testing, it should be: `http://localhost:3004/api/webhooks/stripe`
- Use Stripe CLI for local testing: `stripe listen --forward-to localhost:3004/api/webhooks/stripe`

### 2. Webhook Not Firing
The subscription update webhook might not be running at all.

**Check:**
- Open your terminal where dev server is running
- Look for webhook logs when you create a trial
- Should see: `"Updating subscription with data:"` and `"Subscription activated for organization"`

### 3. Multiple Webhook Events
Both `checkout.session.completed` AND `customer.subscription.updated` fire, and one might be overwriting the other.

**Solution:**
- Check webhook event order in Stripe dashboard logs
- Verify which event runs last

### 4. Environment Variable Override
The `PLAN_PRICING` constant might be imported from a cached module.

**Solution:**
```bash
# Kill ALL node processes
pkill -9 node
# Clear Next.js cache
rm -rf .next
# Restart dev server
PORT=3004 npm run dev
```

## Quick Fix Test

Run this SQL in Supabase to manually update YOUR subscription:

```sql
-- First, find your subscription
SELECT id, organization_id, plan_type, billing_cycle, base_price_cents, status, trial_end_date
FROM subscriptions
WHERE status = 'trialing'
ORDER BY created_at DESC
LIMIT 5;

-- Update YOUR specific subscription (replace the organization_id with yours)
UPDATE subscriptions
SET 
  base_price_cents = 7900,  -- $79 for monthly (or 6500 for yearly)
  updated_at = NOW()
WHERE organization_id = 'YOUR_ORG_ID_HERE'
  AND status = 'trialing';

-- Verify
SELECT id, plan_type, billing_cycle, base_price_cents / 100.0 as price_dollars, status
FROM subscriptions
WHERE organization_id = 'YOUR_ORG_ID_HERE';
```

## Permanent Fix

### Option 1: Use Stripe CLI for Local Development
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe
# or download from https://stripe.com/docs/stripe-cli

# Forward webhooks to local dev server
stripe listen --forward-to http://localhost:3004/api/webhooks/stripe
```

### Option 2: Verify Webhook Logs
1. Check your dev server terminal for webhook logs
2. Look for the pricing calculation log: `"Updating subscription with data:"`
3. Check if `base_price_cents` shows 9700 (old) or 7900 (new)

### Option 3: Force Cache Clear
```bash
# Stop dev server (Ctrl+C)
pkill -9 node
rm -rf .next
rm -rf node_modules/.cache
PORT=3004 npm run dev
```

## What to Check Next

1. **Are webhooks reaching your local server?**
   - Look for webhook logs in terminal
   - If no logs, webhooks aren't being received

2. **Is the webhook using old code?**
   - Check terminal logs for the `base_price_cents` value
   - Should be 7900, not 9700

3. **Is production deployed?**
   - If your webhook points to production, you need to deploy the changes
   - Run: `git push origin pricing-update-individual-plan`

Let me know what you find!

