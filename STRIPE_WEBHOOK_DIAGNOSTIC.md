# Stripe Webhook Diagnostic Guide

## Purpose

This guide helps you verify that Stripe webhooks are properly configured and firing correctly in live mode. If webhooks aren't working, emails will never be sent because the email logic is triggered by the `checkout.session.completed` webhook event.

## Step 1: Access Stripe Webhook Dashboard

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. **CRITICAL:** Toggle to **Live Mode** (top right corner - should show "Viewing live data")
3. Navigate to **Developers** → **Webhooks**

## Step 2: Verify Webhook Endpoint Exists

You should see a webhook endpoint configured for your production app.

### Expected Configuration:

```
Endpoint URL: https://quotetree.ai/api/webhooks/stripe
Status: Enabled
Events: checkout.session.completed (and others)
```

### If Webhook Doesn't Exist:

You need to create it:

1. Click **+ Add endpoint**
2. Enter endpoint URL: `https://quotetree.ai/api/webhooks/stripe`
3. Select events to listen to:
   - `checkout.session.completed` ✅ **CRITICAL**
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Click **Add endpoint**
5. **Copy the webhook signing secret** (starts with `whsec_`)
6. **Add to Vercel:**
   - Vercel Dashboard → Settings → Environment Variables
   - Add `STRIPE_WEBHOOK_SECRET` = `whsec_...`
   - Set for **Production** environment
   - **REDEPLOY YOUR APP**

## Step 3: Check Recent Webhook Events

### After a Trial Checkout:

1. Click on your webhook endpoint
2. Look at the **Events** section
3. Find recent `checkout.session.completed` events (should appear within seconds of checkout)

### What to Look For:

#### ✅ Success (What You Want):
```
checkout.session.completed
Status: 200
Response body: {"received": true}
Time: [recent timestamp]
```

#### ❌ Failure Patterns:

**Pattern 1: No Events Showing Up**
- Problem: Webhook isn't receiving events
- Possible causes:
  - Webhook not configured
  - Wrong endpoint URL
  - Events not selected
  - Using test mode instead of live mode

**Pattern 2: 400 Bad Request**
```
Status: 400
Response: Webhook Error: No signature provided
```
- Problem: Webhook signature verification failed
- Solution: `STRIPE_WEBHOOK_SECRET` in Vercel doesn't match Stripe's signing secret
- Fix:
  1. Copy signing secret from webhook endpoint details
  2. Update `STRIPE_WEBHOOK_SECRET` in Vercel
  3. **MUST redeploy**

**Pattern 3: 500 Internal Server Error**
```
Status: 500
Response: Internal server error
```
- Problem: Code error in webhook handler
- Solution: Check Vercel function logs for the actual error message
- Common causes:
  - Missing environment variable (RESEND_API_KEY, NEXT_PUBLIC_APP_URL, etc.)
  - Database error
  - Supabase service role key issue

**Pattern 4: 307 Redirect**
```
Status: 307
Response: [redirect response]
```
- Problem: Webhook endpoint is redirecting instead of handling the request
- Possible causes:
  - Trailing slash issue
  - Middleware redirect
- Solution: Verify endpoint URL is exact: `https://quotetree.ai/api/webhooks/stripe`

## Step 4: Inspect Event Details

Click on a recent `checkout.session.completed` event to see details:

### Request Body:

Should contain:
```json
{
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "id": "cs_...",
      "customer": "cus_...",
      "customer_email": "user@example.com",
      "customer_details": {
        "email": "user@example.com",
        "name": "John Doe"
      },
      "subscription": "sub_...",
      "metadata": {
        "landing_page_purchase": "true",
        "plan_type": "organization",
        "billing_cycle": "monthly",
        "additional_licenses": "0"
      }
    }
  }
}
```

### Check Metadata:

The metadata is critical for the webhook to know what type of purchase this was:

- `landing_page_purchase`: Should be "true" for unauthenticated checkouts
- `plan_type`: "individual" or "organization"
- `billing_cycle`: "monthly" or "yearly"

### Response:

Should show:
```json
{
  "received": true
}
```

If you see an error response, that's your smoking gun! The error message will tell you exactly what's wrong.

## Step 5: Test Webhook Delivery

Stripe allows you to manually resend webhook events for testing:

1. Find a recent `checkout.session.completed` event
2. Click **...** (more options)
3. Click **Resend event**
4. Watch for the response

This is useful for debugging without having to complete another real checkout.

## Common Issues & Solutions

### Issue 1: Webhook Secret Mismatch

**Symptoms:**
- 400 Bad Request
- "Webhook Error: No signature provided" or "signature verification failed"

**Solution:**
```bash
# 1. Get the correct signing secret
# Stripe Dashboard → Developers → Webhooks → Click your endpoint → "Signing secret"

# 2. Update in Vercel
# Vercel Dashboard → Settings → Environment Variables
# Update STRIPE_WEBHOOK_SECRET = whsec_...
# Environment: Production

# 3. MUST REDEPLOY
# Either:
git commit --allow-empty -m "Update webhook secret"
git push
# Or trigger redeploy in Vercel dashboard
```

### Issue 2: Wrong Stripe Mode

**Symptoms:**
- Webhook works in test mode but not live mode
- No events showing up in live mode

**Solution:**
- Make sure you created a webhook in **Live Mode** (not Test Mode)
- Stripe has separate webhooks for test and live mode
- Check top-right corner says "Viewing live data"

### Issue 3: Environment Variable Issues

**Symptoms:**
- 500 Internal Server Error
- Webhook fires but doesn't complete

**Solution:**
1. Check Vercel function logs for actual error:
   - Vercel Dashboard → Functions → `/api/webhooks/stripe`
2. Common missing variables:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RESEND_API_KEY`
   - `NEXT_PUBLIC_APP_URL`
3. Add missing variables and **REDEPLOY**

### Issue 4: Endpoint URL Wrong

**Symptoms:**
- 404 Not Found
- 307 Redirect

**Solution:**
- Verify exact URL: `https://quotetree.ai/api/webhooks/stripe`
- No trailing slash
- Must be your production domain
- Must match your deployed app URL

## Webhook Event Timeline

When a trial checkout completes, this sequence should happen:

1. **User completes checkout** on quotetree.ai
2. **Stripe creates subscription** and customer
3. **Stripe sends webhook event** to your endpoint (within 1-2 seconds)
4. **Your webhook handler executes:**
   - Creates user account (if new)
   - Creates organization
   - Sends password reset email
   - Sends welcome email
   - Updates subscription in database
5. **Webhook returns 200** to Stripe
6. **User receives emails** (within 1-2 minutes)

If step 3 or 4 fails, emails will never be sent.

## Testing Checklist

- [ ] Webhook endpoint exists in Stripe Live Mode
- [ ] Endpoint URL is correct: `https://quotetree.ai/api/webhooks/stripe`
- [ ] `checkout.session.completed` event is selected
- [ ] Recent events show 200 status
- [ ] Response body is `{"received": true}`
- [ ] Request includes customer email and metadata
- [ ] Webhook signing secret matches Vercel `STRIPE_WEBHOOK_SECRET`
- [ ] App has been redeployed after any secret changes

## Next Steps

### If Webhook is Working (200 responses):
✅ Webhook is fine! The issue is elsewhere:
- Check Vercel function logs for email sending errors
- Check Supabase auth logs
- Check Resend dashboard logs
- See: `LIVE_MODE_EMAIL_TROUBLESHOOTING.md`

### If Webhook is Failing:
❌ Fix the webhook first:
1. Note the error code and message
2. Fix the configuration issue
3. Update environment variables if needed
4. **REDEPLOY**
5. Test again with a new checkout

## Monitoring Webhooks

### Set Up Webhook Monitoring:

1. **Stripe Dashboard** → **Developers** → **Webhooks** → Your endpoint
2. Click **Configure** → **Failure notifications**
3. Add your email to get notified of webhook failures

### Check Webhook Health:

Stripe shows success rate and recent failures on the webhook dashboard.

**Healthy webhook:**
- 100% success rate
- All recent events show 200
- Quick response times (< 1 second)

**Unhealthy webhook:**
- < 100% success rate
- Recent 4xx or 5xx errors
- Slow response times

## Still Having Issues?

If webhooks are returning 200 but emails still aren't being sent:

1. The webhook is working ✅
2. The problem is in the email sending logic
3. Check Vercel function logs for the actual error
4. Follow steps 4-7 in `LIVE_MODE_EMAIL_TROUBLESHOOTING.md`

If webhooks are failing:

1. Copy the exact error message from Stripe
2. Check Vercel function logs at the same timestamp
3. The error message will tell you exactly what's wrong
4. Fix the issue and redeploy

