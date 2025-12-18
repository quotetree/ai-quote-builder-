# Live Mode Email Troubleshooting Guide

## Issue
Trial checkout in live mode completes successfully, but emails are not being sent:
- ❌ Password reset email (from Supabase)
- ❌ Welcome email (from Resend)

These emails work correctly in test mode but fail in live/production mode.

## Step 1: Check Vercel Function Logs ⚡ START HERE

**This is the most important step - it will tell you exactly what's happening.**

### How to Access Vercel Logs:

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your QuoteTree project
3. Click on "Functions" tab
4. Find `/api/webhooks/stripe/route` function
5. Click to view logs

### What to Look For:

After completing a trial checkout, search for these specific log messages:

#### ✅ Success Messages (What you want to see):
```
✅ Password setup email sent successfully to: [email]
✅ Welcome email sent via Resend to: [email]
Subscription activated for organization [id]
```

#### ❌ Error Messages (Problems to diagnose):
```
❌ CRITICAL: Password setup email failed: [error details]
⚠️ Welcome email failed (non-critical): [error details]
```

#### 🔍 Other Important Messages:
```
Processing landing page purchase for: [email]
User created: [user_id]
Organization found: [org_id]
```

### Common Error Patterns:

**If you see:**
- `"RESEND_API_KEY is not defined"` → Missing environment variable
- `"Failed to send welcome email"` → Resend API issue
- `"resetPasswordForEmail failed"` → Supabase auth issue
- `"Webhook signature verification failed"` → Webhook secret mismatch

### Action:
**Copy the relevant log entries and proceed to the next step based on what you find.**

---

## Step 2: Verify Vercel Environment Variables

### How to Check:

1. Vercel Dashboard → Your Project → **Settings** → **Environment Variables**
2. Make sure you're viewing **Production** environment (not Preview or Development)

### Required Variables:

```bash
# Supabase - Production Project
NEXT_PUBLIC_SUPABASE_URL=https://[your-prod-project].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... (starts with eyJ)
SUPABASE_SERVICE_ROLE_KEY=eyJ... (different from anon key)

# Resend - Production API Key
RESEND_API_KEY=re_... (must start with re_ for live mode)

# App URL - Must be production domain
NEXT_PUBLIC_APP_URL=https://quotetree.ai

# Stripe - Live Mode
STRIPE_SECRET_KEY=sk_live_... (must be sk_live_ not sk_test_)
STRIPE_WEBHOOK_SECRET=whsec_... (from production webhook endpoint)
```

### How to Verify Each:

#### ✅ RESEND_API_KEY
- Should start with `re_`
- Go to [Resend Dashboard](https://resend.com/api-keys) to verify
- Make sure it's a production key, not a test key
- **Action if missing:** Add the variable and redeploy

#### ✅ NEXT_PUBLIC_APP_URL
- Should be `https://quotetree.ai` (your production domain)
- **Not** `http://localhost:3000` or a Vercel preview URL
- This is used in the password reset redirect link (line 187 in webhook)
- **Action if wrong:** Update and redeploy

#### ✅ Supabase Keys
- Go to [Supabase Dashboard](https://app.supabase.com)
- Make sure you're in your **production project** (not staging/dev)
- Settings → API → Copy the URL and keys
- Compare with Vercel environment variables
- **Action if mismatch:** Update to production project keys and redeploy

#### ✅ STRIPE_SECRET_KEY & STRIPE_WEBHOOK_SECRET
- Live key must start with `sk_live_`
- Webhook secret must match your production webhook endpoint
- **Action if test mode:** Update to live keys and redeploy

### Critical Note:
**After changing ANY environment variable, you MUST redeploy:**
```bash
# Option 1: Trigger a redeploy in Vercel dashboard
# Option 2: Push a commit to trigger auto-deploy
git commit --allow-empty -m "Trigger redeploy after env var update"
git push
```

---

## Step 3: Check Stripe Webhook Logs

### How to Access:

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Make sure you're in **Live Mode** (toggle in top right)
3. Navigate to **Developers** → **Webhooks**
4. Find your production webhook endpoint: `https://quotetree.ai/api/webhooks/stripe`
5. Click on it to view details

### What to Check:

#### A. Webhook Event History
Look for recent `checkout.session.completed` events after your trial purchase.

#### B. Response Status
- ✅ Should show `200` (Success)
- ❌ `400` = Webhook signature verification failed
- ❌ `500` = Internal server error

#### C. Event Details
Click on the event to see:
- Request body (contains customer email, metadata)
- Response body (should be `{"received": true}`)
- Any error messages

### Common Issues:

**Issue: No events showing up**
- Webhook endpoint might not be configured
- Check webhook is listening to `checkout.session.completed` event

**Issue: 400 Response**
- Webhook secret mismatch
- `STRIPE_WEBHOOK_SECRET` in Vercel doesn't match webhook signing secret

**Issue: 500 Response**
- Check Vercel function logs for the actual error
- Likely a code error or missing environment variable

### Action:
- If webhook is working (200 response) but emails still not sending, proceed to Step 4
- If webhook is failing, fix the webhook configuration first

---

## Step 4: Check Supabase Auth Logs

### How to Access:

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your **production project**
3. Navigate to **Authentication** → **Logs**
4. Look at recent activity (last hour)

### What to Look For:

#### A. Password Reset Email Attempts
Search for entries related to password reset:
- Look for your customer's email address
- Check timestamp (should be right after checkout)

#### B. Common Issues:

**Issue: No log entries for password reset**
- The webhook might not be calling `resetPasswordForEmail`
- Check Vercel logs to confirm the call is being made

**Issue: "Rate limit exceeded"**
- Supabase free tier has email rate limits
- Solution: Configure custom SMTP (see Step 6)

**Issue: "Email delivery failed"**
- Could be spam filtering
- Solution: Configure custom SMTP with verified domain

**Issue: "Invalid redirect URL"**
- Check `NEXT_PUBLIC_APP_URL` is correct
- Verify URL is in Supabase Auth → URL Configuration → Redirect URLs

### Additional Checks:

#### A. Email Provider Settings
1. Authentication → Providers → **Email**
2. Verify email provider is enabled
3. Check if email confirmations are set up correctly

#### B. URL Configuration
1. Settings → Auth → **URL Configuration**
2. **Site URL** should be `https://quotetree.ai`
3. **Redirect URLs** should include:
   - `https://quotetree.ai/auth/callback`
   - `https://quotetree.ai/auth/reset-password`

---

## Step 5: Check Resend Dashboard Logs

### How to Access:

1. Go to [Resend Dashboard](https://resend.com/logs)
2. View recent email send attempts

### What to Look For:

#### A. Welcome Email Send Attempts
Look for emails sent to your test customer after checkout.

#### B. Status Codes:
- ✅ `200` = Email sent successfully
- ❌ `4xx` = Client error (API key, domain, etc.)
- ❌ `5xx` = Server error

### Common Issues:

**Issue: No API calls showing up**
- `RESEND_API_KEY` environment variable is missing or incorrect
- Check Vercel logs for "Welcome email failed" error

**Issue: "Domain not verified"**
- Sender email domain must be verified in Resend
- Go to Resend → Domains → Add `quotetree.ai`
- Add DNS records (SPF, DKIM, DMARC)

**Issue: "Invalid API key"**
- Using test key instead of live key
- Live keys start with `re_`
- Update `RESEND_API_KEY` in Vercel

### Domain Verification:

If your domain isn't verified:

1. **Resend Dashboard** → **Domains**
2. Click **Add Domain**
3. Enter `quotetree.ai`
4. Add the DNS records to your domain registrar:
   - SPF record
   - DKIM record
   - DMARC record (optional but recommended)
5. Wait for verification (usually < 1 hour)
6. Update email sender addresses to use verified domain:
   - `sam@quotetree.ai` (in webhook, line 88)
   - `noreply@quotetree.ai` (if using custom SMTP)

---

## Step 6: Configure Supabase Custom SMTP (If Needed)

**When to do this:**
- Supabase logs show rate limiting
- Emails are going to spam
- Supabase auth emails are failing to deliver

### Get Resend SMTP Credentials:

1. Go to [Resend Dashboard](https://resend.com)
2. Navigate to **API Keys** → **SMTP**
3. Note your SMTP credentials:
   - **Host:** `smtp.resend.com`
   - **Port:** `465` (SSL) or `587` (TLS)
   - **Username:** Usually `resend`
   - **Password:** A generated credential (NOT your API key)

### Configure in Supabase:

1. **Supabase Dashboard** → **Settings** → **Auth**
2. Scroll to **SMTP Settings**
3. Enable **Custom SMTP Server**
4. Fill in the details:
   ```
   Host: smtp.resend.com
   Port Number: 465
   Username: resend
   Password: [Your SMTP password from Resend]
   Sender email: noreply@quotetree.ai
   Sender name: QuoteTree
   ```
5. Click **Save**
6. Test by requesting a password reset

### Important Notes:
- Use SMTP credentials, NOT your Resend API key
- Sender email must be from a verified domain in Resend
- Port 465 uses SSL, port 587 uses TLS (either works)

---

## Step 7: End-to-End Test

### Test Procedure:

1. **Open Incognito/Private Browser Window**
2. **Go to your production site:** `https://quotetree.ai`
3. **Start a trial checkout:**
   - Click "Start 14-Day Trial"
   - Enter a REAL email address you can check
   - Use Stripe test card: `4242 4242 4242 4242`
4. **Complete the checkout**
5. **Monitor all systems simultaneously:**

### What to Monitor:

#### A. Vercel Logs (Real-time)
- Open Vercel dashboard → Functions → `/api/webhooks/stripe`
- Watch for log entries as webhook fires
- Look for success/error messages

#### B. Stripe Webhook Dashboard
- Refresh to see new event
- Verify 200 response

#### C. Email Inbox
- Check the email you used for checkout
- Wait 1-2 minutes for delivery
- **Check spam folder!**

### Expected Results:

✅ **You should receive TWO emails:**

1. **Password Setup Email** (from Supabase):
   - Subject: "Reset Your Password" or similar
   - Contains link to set your password
   - Link should redirect to: `https://quotetree.ai/auth/reset-password`

2. **Welcome Email** (from Resend):
   - Subject: "Welcome to QuoteTree 🙌"
   - From: "Sam from QuoteTree <sam@quotetree.ai>"
   - Contains onboarding instructions

### If Emails Don't Arrive:

**Wait 5 minutes** (sometimes there's a delay), then check:

1. ✅ Spam/Junk folder
2. ✅ Vercel logs for error messages
3. ✅ Stripe webhook returned 200
4. ✅ Supabase auth logs show email sent
5. ✅ Resend logs show email delivered

---

## Quick Diagnostic Checklist

Use this checklist to quickly identify the issue:

- [ ] Vercel logs show webhook executed successfully
- [ ] Vercel logs show "Password setup email sent successfully"
- [ ] Vercel logs show "Welcome email sent via Resend"
- [ ] Stripe webhook returns 200 status
- [ ] `RESEND_API_KEY` is set in Vercel Production (starts with `re_`)
- [ ] `NEXT_PUBLIC_APP_URL` is set to `https://quotetree.ai`
- [ ] All Supabase keys point to production project
- [ ] Stripe keys are live mode (start with `sk_live_`)
- [ ] Resend domain is verified
- [ ] Supabase auth logs show password reset attempt
- [ ] Resend logs show API call
- [ ] Checked spam folder for emails

---

## Common Solutions Summary

### Solution 1: Missing Environment Variables
```bash
# Add to Vercel Production environment:
RESEND_API_KEY=re_your_live_key
NEXT_PUBLIC_APP_URL=https://quotetree.ai

# Then redeploy
```

### Solution 2: Wrong Supabase Project
```bash
# Update to production project keys in Vercel:
NEXT_PUBLIC_SUPABASE_URL=https://prod-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Solution 3: Domain Not Verified
1. Resend Dashboard → Domains → Add `quotetree.ai`
2. Add DNS records
3. Wait for verification

### Solution 4: Configure Custom SMTP
1. Get Resend SMTP credentials
2. Configure in Supabase Auth → SMTP Settings
3. Test password reset

### Solution 5: Webhook Not Configured
1. Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://quotetree.ai/api/webhooks/stripe`
3. Select `checkout.session.completed` event
4. Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`

---

## Need Help?

If you're still stuck after following all these steps, collect this information:

1. **Vercel function logs** (especially error messages)
2. **Stripe webhook response** (status code + response body)
3. **Supabase auth logs** (any errors or rate limits)
4. **Resend logs** (API calls and responses)
5. **Environment variables checklist** (which ones are set)

Then we can diagnose the specific issue based on the logs.

