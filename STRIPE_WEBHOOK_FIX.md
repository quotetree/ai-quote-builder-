# Stripe Webhook Fix - Complete Guide

## ✅ Issue Fixed: Webhooks Returning 307 Redirects

**Problem**: Stripe webhooks were being redirected (307) because middleware was checking for authentication.

**Solution**: Updated middleware to exclude webhook routes from authentication checks.

## 🔧 Changes Made:

1. **Updated `lib/supabase/middleware.ts`** - Added webhook route exclusions
2. **Updated `middleware.ts`** - Excluded webhook paths from matcher

## 📋 Next Steps:

### Step 1: Restart Your Dev Server

**IMPORTANT**: Make sure you're in the project directory first!

```bash
# Navigate to your project directory
cd /Users/samuelbettencourt/Desktop/cursor-projects/quote-tree-ai

# Then start the server
npm run dev
```

### Step 2: Keep Stripe CLI Running

In a **separate terminal**, keep this running:

```bash
stripe listen --forward-to localhost:3002/api/webhooks/stripe
```

### Step 3: Test Again

1. Go to your app
2. Complete a checkout
3. **Check Stripe CLI terminal** - you should see `[200]` instead of `[307]`
4. **Check your Next.js terminal** - you should see webhook handler logs
5. Refresh your Billing page - subscription should be updated!

## ✅ Expected Results:

**In Stripe CLI:**
```
--> checkout.session.completed [evt_xxx]
<-- [200] POST http://localhost:3002/api/webhooks/stripe [evt_xxx]  ✅
```

**In Next.js Terminal:**
```
POST /api/webhooks/stripe 200 in 150ms
Subscription activated for organization xxx
```

**In Your App:**
- Billing page shows your new plan
- Plan type updated to "Individual" or "Organization"
- Status shows "Active"

## 🐛 If Still Not Working:

1. **Check webhook secret matches** - Ensure `.env.local` has the correct `STRIPE_WEBHOOK_SECRET`
2. **Check port number** - Make sure Stripe CLI forwards to the same port your app runs on
3. **Check server logs** - Look for error messages in Next.js terminal
4. **Manually trigger webhook** - Use Stripe CLI to replay events:
   ```bash
   stripe events resend evt_xxx  # Replace with actual event ID
   ```

## 📝 Quick Verification:

Run this SQL in Supabase to check your subscription:

```sql
SELECT 
  s.*,
  o.name as org_name,
  p.email as owner_email
FROM subscriptions s
JOIN organizations o ON s.organization_id = o.id
JOIN profiles p ON o.owner_id = p.id
ORDER BY s.updated_at DESC
LIMIT 5;
```

You should see your subscription with:
- `status = 'active'`
- `plan_type = 'individual'` or `'organization'`
- `stripe_subscription_id` populated

