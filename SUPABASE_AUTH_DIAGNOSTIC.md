# Supabase Auth Email Diagnostic Guide

## Purpose

This guide helps you verify that Supabase Auth is attempting to send password reset emails and diagnose any delivery issues. Even if your webhook is working, Supabase emails may fail due to rate limits, deliverability issues, or configuration problems.

## Step 1: Access Supabase Auth Logs

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. **CRITICAL:** Make sure you're in your **PRODUCTION project** (check project name in top-left)
3. Navigate to **Authentication** → **Logs**

## Step 2: Check Recent Auth Events

### After a Trial Checkout:

Look for events related to your customer's email address.

### Events to Look For:

#### 1. User Creation
```
Event: user.created
Email: [customer email]
Timestamp: [right after checkout]
```

This confirms the webhook successfully created the user account.

#### 2. Password Reset Email Request
```
Event: recovery.requested
Email: [customer email]
Timestamp: [seconds after user.created]
```

This confirms `resetPasswordForEmail` was called.

#### 3. Email Sent (if using default SMTP)
```
Event: recovery.sent
Email: [customer email]
Status: success
```

This confirms Supabase attempted to send the email.

### Common Patterns:

#### ✅ Success Pattern:
```
user.created → recovery.requested → recovery.sent (success)
```
If you see this but customer doesn't receive email:
- Email went to spam
- Deliverability issue with Supabase default SMTP
- **Solution:** Configure custom SMTP (see Step 6)

#### ❌ Failure Pattern 1: No recovery.requested
```
user.created → [nothing else]
```
Problem: Webhook isn't calling `resetPasswordForEmail`
- Check Vercel logs for errors
- Check if `NEXT_PUBLIC_APP_URL` is set
- Verify webhook code is executing email logic

#### ❌ Failure Pattern 2: Rate Limited
```
recovery.requested → Error: Rate limit exceeded
```
Problem: Supabase rate limits hit
- Free tier has limited email sends
- **Solution:** Configure custom SMTP or upgrade plan

#### ❌ Failure Pattern 3: Invalid Redirect URL
```
recovery.requested → Error: Invalid redirect URL
```
Problem: `NEXT_PUBLIC_APP_URL` is wrong or not in allowed URLs
- Check `NEXT_PUBLIC_APP_URL` in Vercel
- Check Auth URL Configuration (see below)

## Step 3: Check Email Provider Configuration

### Navigate to Email Settings:

1. **Authentication** → **Providers** → **Email**
2. Verify settings:

#### Email Provider Status:
- ✅ Email provider should be **Enabled**
- ✅ "Confirm email" - Check if this is enabled
  - If enabled: Users must confirm email before logging in
  - If disabled: Users can log in immediately (your current setup with `email_confirm: true`)

#### Rate Limits:
- Free tier: Limited emails per hour
- If hitting limits frequently, upgrade or configure custom SMTP

### Check SMTP Configuration:

Still in Authentication → Providers → Email settings:

#### Using Default Supabase SMTP:
```
SMTP Provider: Supabase (default)
Status: [No custom SMTP configured]
```

**Limitations:**
- Lower deliverability (more likely to go to spam)
- Rate limits on free tier
- No sender customization

**When This Works:**
- Development/testing
- Low volume
- Free tier limits not exceeded

**When to Use Custom SMTP:**
- Production with higher volume
- Emails going to spam
- Need better deliverability
- Want custom sender domain

#### Using Custom SMTP:
```
SMTP Provider: Custom
Host: smtp.resend.com
Port: 465
Sender: noreply@quotetree.ai
Status: Configured
```

**Benefits:**
- Better deliverability
- Higher sending limits
- Custom sender domain
- More reliable

## Step 4: Check URL Configuration

### Navigate to URL Settings:

1. **Settings** → **Auth** → **URL Configuration**
2. Verify the following:

#### Site URL:
```
Site URL: https://quotetree.ai
```

This should be your production domain, NOT:
- ❌ `http://localhost:3000`
- ❌ `https://xyz.vercel.app`
- ✅ `https://quotetree.ai`

#### Redirect URLs:

Your allowed redirect URLs should include:
```
https://quotetree.ai/auth/callback
https://quotetree.ai/auth/reset-password
https://quotetree.ai/auth/accept-invite
```

**If redirect URLs are missing or wrong:**
1. Add the correct URLs
2. Click **Save**
3. Test password reset again

## Step 5: Test Password Reset Manually

To isolate whether the issue is with webhooks or Supabase auth:

### Manual Test Procedure:

1. **Go to your app's forgot password page:** `https://quotetree.ai/auth/forgot-password`
2. **Enter the same email** you used for trial checkout
3. **Submit the form**
4. **Check Supabase Auth Logs** immediately
5. **Check email inbox** (and spam)

### Expected Results:

**In Supabase Logs:**
```
recovery.requested → recovery.sent (success)
```

**In Email:**
- Should receive password reset email within 1-2 minutes
- Email subject: "Reset Your Password" or similar
- Link should work and redirect properly

### If Manual Test Works:

✅ Supabase auth is working correctly!
- The problem is in the webhook execution
- Check Vercel logs to see if webhook is calling `resetPasswordForEmail`
- Check if any errors are being caught and suppressed

### If Manual Test Fails:

❌ Supabase auth has a problem:
- Check auth logs for specific error
- Verify email provider is enabled
- Check rate limits
- Consider configuring custom SMTP

## Step 6: Check Rate Limits

### Supabase Email Rate Limits:

**Free Tier:**
- Limited emails per hour
- Exact limits vary by project

**Paid Tier:**
- Higher limits
- Better for production

### How to Check If Rate Limited:

1. Look in Auth Logs for "rate limit" errors
2. Check project usage: **Settings** → **Usage**
3. Look for email sending metrics

### If Rate Limited:

**Option 1: Wait**
- Rate limits reset after time period
- Not viable for production

**Option 2: Upgrade Plan**
- **Settings** → **Billing**
- Upgrade to paid tier
- Higher rate limits

**Option 3: Configure Custom SMTP (Recommended)**
- Use Resend SMTP (you're already using Resend for welcome emails)
- Bypasses Supabase rate limits
- Better deliverability
- See: Step 7 and `RESEND_SMTP_SETUP.md`

## Step 7: Check Email Templates

### Navigate to Email Templates:

1. **Authentication** → **Email Templates**
2. Find **"Reset Password" template**

### Verify Template:

The template should contain the recovery link variable:

```html
<p>Follow this link to reset your password:</p>
<p><a href="{{ .ConfirmationURL }}">Reset Password</a></p>
```

### Common Issues:

**Issue:** Missing `{{ .ConfirmationURL }}` variable
- Template won't include the reset link
- User can't reset password

**Issue:** Wrong redirect URL in template
- Some templates have hardcoded URLs
- Should use the variable, not hardcoded

**Solution:**
- Reset to default template if customized
- Or ensure `{{ .ConfirmationURL }}` is present

## Step 8: Check Email Deliverability

If Supabase shows "email sent" but customer doesn't receive it:

### Check Spam Folder:

🔍 **Always check spam first!**
- Supabase default SMTP has lower reputation
- More likely to be filtered as spam
- This is why custom SMTP is recommended

### Check Email Provider:

Some email providers (especially corporate/school emails) have strict filters:
- Gmail: Usually works, check spam
- Outlook/Office365: May block or delay
- Corporate email: Often has strict filters
- Custom domain: Check SPF/DKIM records

### Deliverability Solutions:

**Short-term:**
- Ask users to check spam
- Whitelist sender address

**Long-term (Recommended):**
- Configure custom SMTP with Resend
- Use verified domain
- Better sender reputation
- See: `RESEND_SMTP_SETUP.md`

## Common Issues & Solutions

### Issue 1: No recovery.requested Event

**Symptoms:**
- User created but no password reset attempted
- Webhook logs don't show email sending

**Diagnosis:**
Check Vercel logs for:
```
❌ CRITICAL: Password setup email failed
```

**Common Causes:**
- `NEXT_PUBLIC_APP_URL` not set
- Supabase service role key wrong
- Code error in webhook

**Solution:**
1. Check Vercel logs for actual error
2. Verify all environment variables
3. Check webhook code execution

### Issue 2: Rate Limit Exceeded

**Symptoms:**
- Works in test mode, fails in production
- Auth logs show "rate limit exceeded"

**Solution:**
Configure custom SMTP (bypasses Supabase limits):
1. See `RESEND_SMTP_SETUP.md`
2. Get Resend SMTP credentials
3. Configure in Supabase
4. Test again

### Issue 3: Email Sent But Not Received

**Symptoms:**
- Supabase logs show "recovery.sent (success)"
- Customer doesn't receive email
- Not in spam folder

**Possible Causes:**
- Email provider blocking
- Deliverability issue
- Delayed (wait 5-10 minutes)

**Solution:**
1. Wait 5-10 minutes
2. Check spam again
3. Try different email provider
4. Configure custom SMTP for better deliverability

### Issue 4: Invalid Redirect URL

**Symptoms:**
- "Invalid redirect URL" error in logs
- Email sent but link doesn't work

**Solution:**
1. Check `NEXT_PUBLIC_APP_URL` in Vercel
2. Add redirect URLs in Supabase:
   - Settings → Auth → URL Configuration
   - Add: `https://quotetree.ai/auth/reset-password`
   - Add: `https://quotetree.ai/auth/callback`
3. Redeploy app

## Monitoring Checklist

- [ ] Supabase Auth Logs show user.created events
- [ ] recovery.requested appears after user creation
- [ ] recovery.sent shows success (not error)
- [ ] No rate limit errors
- [ ] Email provider is enabled
- [ ] Site URL is set to production domain
- [ ] Redirect URLs include reset-password page
- [ ] Email template contains {{ .ConfirmationURL }}
- [ ] Manual password reset test works

## Next Steps

### If Supabase Logs Show Errors:
- Fix the specific error shown in logs
- Update environment variables if needed
- Configure custom SMTP if rate limited

### If Supabase Shows Success But Emails Don't Arrive:
- Check spam folder thoroughly
- Wait 5-10 minutes for delayed delivery
- **Configure custom SMTP for better deliverability**
- See: `RESEND_SMTP_SETUP.md`

### If Everything Looks Good in Supabase:
- Check Resend dashboard for welcome email
- See: `LIVE_MODE_EMAIL_TROUBLESHOOTING.md` Step 5

