# 🚀 START HERE: Live Mode Email Troubleshooting

## Problem

Your trial checkout works in **test mode** but emails aren't being sent in **live/production mode**:
- ❌ Password reset email (from Supabase)
- ❌ Welcome email (from Resend)

## Solution Overview

This is almost always caused by one of these issues:

1. **Missing or incorrect environment variables** in Vercel Production
2. **Domain not verified** in Resend
3. **Stripe webhook** not configured for live mode
4. **Supabase** pointing to wrong project or having rate limits

## Quick Start: Follow This Path

### Step 1: Start with the Master Guide ⭐

📖 **Read:** `LIVE_MODE_EMAIL_TROUBLESHOOTING.md`

This comprehensive guide walks you through all diagnostic steps in order.

### Step 2: Check Environment Variables First

📝 **Use:** `ENV_VARS_CHECKLIST.md`

Most common issue! Verify all required environment variables in Vercel:
- `RESEND_API_KEY`
- `NEXT_PUBLIC_APP_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

**Optional:** Run `node scripts/check-env-config.js` to check your local environment.

### Step 3: Check Vercel Function Logs 

This is the MOST IMPORTANT step - it will tell you exactly what's wrong.

1. Go to Vercel Dashboard → Your Project → Functions
2. Find `/api/webhooks/stripe`
3. Look for these messages after a trial checkout:
   - ✅ "Password setup email sent successfully"
   - ✅ "Welcome email sent via Resend"
   - ❌ Any error messages

**The error message will point you to the exact problem.**

### Step 4: Use Specific Diagnostic Guides

Based on what you find, use these targeted guides:

#### If Webhook Issues:
📖 **`STRIPE_WEBHOOK_DIAGNOSTIC.md`**
- Webhook not firing
- Webhook returning errors
- Signature verification failures

#### If Supabase Auth Email Issues:
📖 **`SUPABASE_AUTH_DIAGNOSTIC.md`**
- Password reset emails not sending
- Rate limits
- Deliverability issues

#### If Resend Welcome Email Issues:
📖 **`RESEND_DIAGNOSTIC.md`**
- Welcome emails not sending
- Domain verification
- API key issues

#### If You Need Better Deliverability:
📖 **`RESEND_SMTP_SETUP.md`**
- Configure custom SMTP for Supabase
- Improve email deliverability
- Bypass rate limits

### Step 5: Test End-to-End

📖 **`END_TO_END_TEST_GUIDE.md`**

Complete testing guide to verify everything works.

## Troubleshooting Flow Diagram

```
Trial Checkout (Live Mode)
          ↓
  Stripe Webhook Fires?
    ├─ NO → Check STRIPE_WEBHOOK_DIAGNOSTIC.md
    └─ YES (200) ↓
          
    Vercel Logs Show Errors?
    ├─ YES → Fix specific error (usually env vars)
    └─ NO (shows success) ↓
          
    Password Reset Email Sent?
    ├─ NO → Check SUPABASE_AUTH_DIAGNOSTIC.md
    └─ YES ↓
          
    Welcome Email Sent?
    ├─ NO → Check RESEND_DIAGNOSTIC.md
    └─ YES ↓
          
    Emails Received?
    ├─ NO → Check spam, configure SMTP
    └─ YES ✅
          
    ✅ WORKING!
```

## Quick Fixes for Common Issues

### Issue 1: "RESEND_API_KEY is not defined"

**Fix:**
1. Vercel Dashboard → Settings → Environment Variables
2. Add `RESEND_API_KEY` = `re_...` (your live Resend API key)
3. Set for **Production** environment
4. **Redeploy your app**

### Issue 2: "Domain not verified"

**Fix:**
1. Resend Dashboard → Domains
2. Add `quotetree.ai`
3. Configure DNS records (SPF, DKIM, DMARC)
4. Wait for verification (15min - 48hrs)

### Issue 3: Webhook Returning 400/500

**Fix:**
1. Check Stripe Dashboard → Webhooks → Your endpoint
2. Verify signing secret matches Vercel `STRIPE_WEBHOOK_SECRET`
3. Check Vercel logs for actual error
4. Fix the error and redeploy

### Issue 4: Using Test Mode Keys in Production

**Fix:**
1. Verify `STRIPE_SECRET_KEY` starts with `sk_live_` (not `sk_test_`)
2. Verify `RESEND_API_KEY` starts with `re_` (not test key)
3. Update in Vercel Production environment
4. **Redeploy**

### Issue 5: Wrong Supabase Project

**Fix:**
1. Verify `NEXT_PUBLIC_SUPABASE_URL` points to production project
2. Verify `SUPABASE_SERVICE_ROLE_KEY` is from production project
3. Update in Vercel
4. **Redeploy**

## File Guide: Which Document to Use When

| Document | When to Use |
|----------|-------------|
| **`START_HERE.md`** | You're here! Overview and quick start |
| **`LIVE_MODE_EMAIL_TROUBLESHOOTING.md`** | Complete diagnostic walkthrough (START HERE) |
| **`ENV_VARS_CHECKLIST.md`** | Verify environment variables configuration |
| **`STRIPE_WEBHOOK_DIAGNOSTIC.md`** | Webhook not firing or returning errors |
| **`SUPABASE_AUTH_DIAGNOSTIC.md`** | Password reset emails not working |
| **`RESEND_DIAGNOSTIC.md`** | Welcome emails not working |
| **`RESEND_SMTP_SETUP.md`** | Set up custom SMTP for better deliverability |
| **`END_TO_END_TEST_GUIDE.md`** | Test the complete flow |
| **`scripts/check-env-config.js`** | Check local environment variables |

## What Each Email Does

### Email 1: Password Setup (Supabase Auth)

**Purpose:** New user sets their password
- Sent via: `supabase.auth.resetPasswordForEmail()`
- Provider: Supabase Auth (or custom SMTP if configured)
- Sender: `noreply@quotetree.ai` (or Supabase default)
- Critical: Contains link to set password

**Triggered by:** Line 184 in `app/api/webhooks/stripe/route.ts`

### Email 2: Welcome Email (Resend)

**Purpose:** Welcome message and onboarding
- Sent via: Resend API (`sendWelcomeEmail()`)
- Provider: Resend
- Sender: `sam@quotetree.ai`
- Friendly: Contains welcome message and next steps

**Triggered by:** Line 218 in `app/api/webhooks/stripe/route.ts`

## Critical Environment Variables

These MUST be set in Vercel Production:

```bash
# Supabase (Production Project)
NEXT_PUBLIC_SUPABASE_URL=https://[prod-project].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Resend (Live API Key)
RESEND_API_KEY=re_...

# App URL (Production Domain)
NEXT_PUBLIC_APP_URL=https://quotetree.ai

# Stripe (Live Mode)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## After Fixing: Remember to Redeploy!

⚠️ **CRITICAL:** After changing ANY environment variable, you MUST redeploy:

**Option 1:** Vercel Dashboard
- Go to Deployments
- Click **...** on latest → **Redeploy**

**Option 2:** Git Push
```bash
git commit --allow-empty -m "Trigger redeploy after env var update"
git push
```

**Option 3:** Vercel CLI
```bash
vercel --prod
```

## Testing Your Fix

After making changes:

1. **Redeploy** (critical!)
2. **Wait** for deployment to complete
3. **Test** trial checkout in live mode
4. **Monitor** all dashboards simultaneously:
   - Vercel function logs
   - Stripe webhooks
   - Supabase auth logs
   - Resend logs
5. **Check** email inbox (and spam!)

See `END_TO_END_TEST_GUIDE.md` for detailed testing procedure.

## Common Mistakes to Avoid

❌ **Don't:** Forget to redeploy after changing environment variables  
✅ **Do:** Always redeploy

❌ **Don't:** Use test mode keys in production  
✅ **Do:** Use live mode keys (sk_live_, re_)

❌ **Don't:** Use localhost URLs in production  
✅ **Do:** Use production domain (quotetree.ai)

❌ **Don't:** Assume Supabase default SMTP will work great  
✅ **Do:** Consider configuring custom SMTP for better deliverability

❌ **Don't:** Skip checking spam folder  
✅ **Do:** Always check spam when testing

## Need Help?

If you're stuck after following all guides:

1. **Collect Error Messages:**
   - Vercel function logs
   - Stripe webhook response
   - Supabase auth logs
   - Resend logs

2. **Verify Configuration:**
   - All environment variables set correctly
   - All services in production mode
   - App redeployed after changes

3. **Test Individual Components:**
   - Test Resend API key with curl
   - Test password reset manually via forgot password page
   - Test Stripe webhook manually via Stripe dashboard

4. **Check Service Status:**
   - Vercel status
   - Stripe status
   - Supabase status
   - Resend status

## Success Criteria

You know it's working when:

✅ Stripe webhook returns 200  
✅ Vercel logs show both emails sent successfully  
✅ Supabase logs show recovery.sent (success)  
✅ Resend logs show email delivered  
✅ Customer receives password reset email  
✅ Customer receives welcome email  
✅ Password reset link works  
✅ Customer can log in  
✅ Subscription shows correctly in dashboard

## Quick Links

- [Vercel Dashboard](https://vercel.com/dashboard)
- [Stripe Dashboard](https://dashboard.stripe.com) (switch to Live Mode)
- [Supabase Dashboard](https://app.supabase.com)
- [Resend Dashboard](https://resend.com)

---

## 🎯 Next Step

👉 **Start with:** `LIVE_MODE_EMAIL_TROUBLESHOOTING.md`

This complete guide will walk you through every diagnostic step systematically.

Good luck! 🚀

