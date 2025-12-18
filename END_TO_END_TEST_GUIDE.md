# End-to-End Testing Guide for Live Mode Emails

## Purpose

This guide walks you through a complete end-to-end test of the trial checkout flow in live mode to verify both emails are sent and received correctly.

## Before You Start

### Prerequisites Checklist:

- [ ] All environment variables verified in Vercel Production
- [ ] Stripe webhook configured and returning 200
- [ ] Resend domain verified (if using custom domain)
- [ ] Supabase SMTP configured (optional but recommended)
- [ ] Application redeployed after any environment variable changes

## Test Procedure

### Step 1: Prepare for Testing

#### 1.1 Open Multiple Browser Tabs:

Have these dashboards ready to monitor in real-time:

1. **Vercel Functions** - https://vercel.com/dashboard → Your Project → Functions
2. **Stripe Webhooks** - https://dashboard.stripe.com/webhooks (Live mode)
3. **Supabase Auth Logs** - https://app.supabase.com → Your Project → Authentication → Logs
4. **Resend Logs** - https://resend.com/logs
5. **Your Email Inbox** - Use a real email you can access

#### 1.2 Clear Previous Test Data (Optional):

If you want a clean test:
- Clear browser cache/cookies
- Use incognito/private browsing mode
- Use a fresh email address

### Step 2: Start Trial Checkout

#### 2.1 Navigate to Production Site:

1. Go to: `https://quotetree.ai`
2. **DO NOT** log in
3. Find the "Start 14-Day Trial" button
4. Click it

#### 2.2 Stripe Checkout:

You'll be redirected to Stripe Checkout page.

**Enter Test Information:**
```
Email: your-real-email@example.com (use REAL email)
Card Number: 4242 4242 4242 4242
Expiry: Any future date (e.g., 12/25)
CVC: Any 3 digits (e.g., 123)
Name: Your Name
```

⚠️ **IMPORTANT:** Even though you're using test card, use a REAL email address you can check!

#### 2.3 Complete Payment:

1. Click "Subscribe" or "Pay"
2. Wait for confirmation
3. Should redirect to success page

### Step 3: Monitor Systems in Real-Time

**Immediately after completing checkout, check all dashboards:**

#### 3.1 Stripe Webhook (Check First):

Within **1-2 seconds**, you should see:

```
Event: checkout.session.completed
Status: 200 ✓
Response: {"received": true}
Timestamp: [just now]
```

**If NOT showing 200:**
- ❌ Stop here - webhook is broken
- Check webhook configuration
- See: `STRIPE_WEBHOOK_DIAGNOSTIC.md`

#### 3.2 Vercel Function Logs (Check Second):

Within **5-10 seconds**, you should see logs like:

```
Processing landing page purchase for: your-email@example.com
User created: abc-123-def
Organization found: org-456-ghi
✅ Password setup email sent successfully to: your-email@example.com
✅ Welcome email sent via Resend to: your-email@example.com
Subscription activated for organization org-456-ghi
```

**If you see errors:**
- ❌ Note the specific error message
- Common errors:
  - `RESEND_API_KEY is not defined`
  - `CRITICAL: Password setup email failed`
  - `Welcome email failed`
- Fix the error and retest

#### 3.3 Supabase Auth Logs (Check Third):

Within **10-15 seconds**, you should see:

```
user.created - your-email@example.com
recovery.requested - your-email@example.com
recovery.sent - success
```

**If recovery.sent shows error:**
- Check Supabase SMTP configuration
- See: `SUPABASE_AUTH_DIAGNOSTIC.md`

#### 3.4 Resend Logs (Check Fourth):

Within **10-15 seconds**, you should see:

```
To: your-email@example.com
From: Sam from QuoteTree <sam@quotetree.ai>
Subject: Welcome to QuoteTree 🙌
Status: Sent → Delivered
```

**If not showing up:**
- Check `RESEND_API_KEY` is set
- Check domain is verified
- See: `RESEND_DIAGNOSTIC.md`

### Step 4: Check Email Inbox

#### 4.1 Wait for Emails:

**Expected Timeline:**
- Emails should arrive within **1-2 minutes**
- Sometimes can take up to **5 minutes**
- Check spam folder if not in inbox

#### 4.2 Expected Emails:

You should receive **TWO emails**:

**Email 1: Password Setup (from Supabase)**
```
From: QuoteTree <noreply@quotetree.ai> (if custom SMTP)
      OR from Supabase default sender
Subject: "Reset Your Password" or similar
Contains: Link to set your password
```

**Email 2: Welcome Email (from Resend)**
```
From: Sam from QuoteTree <sam@quotetree.ai>
Subject: "Welcome to QuoteTree 🙌"
Contains: Welcome message and onboarding steps
```

#### 4.3 Check Spam Folder:

🔍 **IMPORTANT:** If emails aren't in inbox, CHECK SPAM!

Common spam indicators:
- New sender domain
- Bulk category (Gmail)
- Promotions tab (Gmail)

**If in spam:**
- This is a deliverability issue
- Solution: Configure custom SMTP
- See: `RESEND_SMTP_SETUP.md`

#### 4.4 Test Password Reset Link:

1. Open the password setup email
2. Click the "Reset Password" or "Set Your Password" link
3. Should redirect to: `https://quotetree.ai/auth/reset-password`
4. Should show password reset form

**If link doesn't work:**
- Check `NEXT_PUBLIC_APP_URL` is correct
- Check redirect URLs in Supabase Auth settings
- See: `SUPABASE_AUTH_DIAGNOSTIC.md` Step 4

### Step 5: Complete Account Setup

#### 5.1 Set Password:

1. On the reset password page, enter a new password
2. Confirm password
3. Click "Update Password"
4. Should redirect to login or dashboard

#### 5.2 Log In:

1. Go to: `https://quotetree.ai/auth/signin`
2. Enter your email and new password
3. Click "Sign In"
4. Should successfully log in

#### 5.3 Verify Subscription:

1. Navigate to billing/settings page
2. Should show:
   - Plan: 14-Day Trial
   - Status: Active
   - Licenses: 4 (if organization plan)
   - Next billing date: 14 days from now

## Test Results

### ✅ Successful Test:

All of these should be true:
- [x] Stripe webhook returned 200
- [x] Vercel logs show both emails sent successfully
- [x] Supabase logs show recovery.sent (success)
- [x] Resend logs show email delivered
- [x] Password setup email received
- [x] Welcome email received
- [x] Password reset link works
- [x] Can log in with new password
- [x] Subscription shows correctly in dashboard

**Result:** ✅ Everything is working! Your live mode emails are configured correctly.

### ❌ Failed Test:

If ANY of the above failed, identify which step failed:

**Failure at Step 1-2 (Checkout/Webhook):**
- Issue: Stripe webhook not configured
- Fix: See `STRIPE_WEBHOOK_DIAGNOSTIC.md`

**Failure at Step 3 (Logs show errors):**
- Issue: Environment variables or code errors
- Fix: Check specific error in Vercel logs
- Fix: See `ENV_VARS_CHECKLIST.md`

**Failure at Step 4 (Emails not received):**
- Issue: Email delivery problem
- Fix: Check Supabase and Resend configurations
- Fix: See `SUPABASE_AUTH_DIAGNOSTIC.md` and `RESEND_DIAGNOSTIC.md`

**Failure at Step 5 (Password reset link broken):**
- Issue: URL configuration problem
- Fix: Check `NEXT_PUBLIC_APP_URL` and Supabase redirect URLs

## Common Test Failures

### Failure Pattern 1: Webhook Returns 500

**Symptoms:**
- Stripe shows 500 error
- Vercel logs show error

**Common Causes:**
- Missing environment variable
- Supabase service role key issue
- Database error

**Solution:**
1. Check Vercel logs for actual error
2. Fix the specific issue
3. Redeploy
4. Test again

### Failure Pattern 2: Emails Show "Sent" But Not Received

**Symptoms:**
- All logs show success
- Emails don't arrive in inbox
- Not in spam folder

**Possible Causes:**
- Corporate email filter
- Email provider blocking
- Delayed delivery

**Solution:**
1. Wait 5-10 minutes
2. Check spam folder again
3. Try different email provider (Gmail, etc.)
4. Configure custom SMTP for better deliverability

### Failure Pattern 3: Only One Email Received

**Symptoms:**
- Either password reset OR welcome email arrives
- Other email missing

**Diagnosis:**
- If password reset missing: Supabase issue
- If welcome email missing: Resend issue

**Solution:**
- Check specific service's logs
- See respective diagnostic guide

### Failure Pattern 4: Password Reset Link Broken

**Symptoms:**
- Emails arrive
- Click link shows error or redirects wrong

**Common Causes:**
- `NEXT_PUBLIC_APP_URL` wrong
- Redirect URL not in Supabase allowed list
- Expired token (waited too long)

**Solution:**
1. Verify `NEXT_PUBLIC_APP_URL` in Vercel
2. Check Supabase → Settings → Auth → URL Configuration
3. Request new password reset email

## Testing Checklist

Use this checklist for each test:

### Pre-Test:
- [ ] Vercel Production environment variables verified
- [ ] Stripe webhook configured for live mode
- [ ] Resend domain verified
- [ ] App redeployed if any changes made
- [ ] Dashboards open and ready to monitor

### During Test:
- [ ] Used real email address
- [ ] Used Stripe test card
- [ ] Checkout completed successfully
- [ ] Redirected to success page

### Monitoring:
- [ ] Stripe webhook shows 200 response
- [ ] Vercel logs show successful execution
- [ ] Vercel logs show password email sent
- [ ] Vercel logs show welcome email sent
- [ ] Supabase logs show recovery.sent
- [ ] Resend logs show email delivered

### Email Verification:
- [ ] Received password setup email
- [ ] Received welcome email
- [ ] Checked spam folder if needed
- [ ] Password reset link works
- [ ] Can set new password
- [ ] Can log in successfully

### Post-Test:
- [ ] Subscription shows correctly in dashboard
- [ ] User can access features
- [ ] No console errors
- [ ] Everything functions normally

## Automated Testing Script (Optional)

You can create a simple monitor script to check key endpoints:

```bash
#!/bin/bash

echo "Testing Live Mode Email Configuration..."
echo

# Test 1: Check if Stripe webhook is accessible
echo "1. Checking Stripe webhook endpoint..."
curl -s -o /dev/null -w "%{http_code}" https://quotetree.ai/api/webhooks/stripe
echo

# Test 2: Check if site is reachable
echo "2. Checking main site..."
curl -s -o /dev/null -w "%{http_code}" https://quotetree.ai
echo

echo
echo "Manual checks required:"
echo "- Complete actual checkout"
echo "- Monitor dashboards"
echo "- Check email inbox"
```

## After Successful Test

Once everything works:

### 1. Document Configuration:

Create a note with:
- Date test passed
- Environment variable values (masked)
- Any custom configurations
- Special notes

### 2. Set Up Monitoring:

- Enable Stripe webhook failure notifications
- Monitor Resend delivery rates
- Set up Supabase log alerts (if available)
- Consider setting up error tracking (Sentry, etc.)

### 3. Test Regularly:

- Test after any deployment
- Test after environment variable changes
- Test after infrastructure changes
- Test quarterly to ensure still working

### 4. Prepare for Users:

- Monitor first few real signups closely
- Have support email ready for issues
- Watch for patterns in failed emails
- Be ready to help users who don't receive emails

## Troubleshooting Resources

If test fails, reference these guides:

1. **Environment Variables:** `ENV_VARS_CHECKLIST.md`
2. **Stripe Webhooks:** `STRIPE_WEBHOOK_DIAGNOSTIC.md`
3. **Supabase Auth:** `SUPABASE_AUTH_DIAGNOSTIC.md`
4. **Resend:** `RESEND_DIAGNOSTIC.md`
5. **SMTP Setup:** `RESEND_SMTP_SETUP.md`
6. **Complete Guide:** `LIVE_MODE_EMAIL_TROUBLESHOOTING.md`

## Need Help?

If you've followed all guides and tests still fail:

1. Collect all error messages from logs
2. Note which specific step fails
3. Check configuration one more time
4. Review documentation for each service
5. Contact support for specific service that's failing

Remember: The most common issues are:
- ❌ Missing or incorrect environment variables
- ❌ Domain not verified in Resend
- ❌ Stripe webhook not configured properly
- ❌ Wrong Supabase project (test vs production)

Always check these first!

