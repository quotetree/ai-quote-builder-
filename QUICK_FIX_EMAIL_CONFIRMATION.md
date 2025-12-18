# Quick Fix: Signup Email Not Sending

## Problem
Users aren't receiving confirmation emails when creating trial accounts.

## Most Likely Cause
Email confirmation is **DISABLED** in your Supabase settings. This is actually common and means users can log in immediately without confirming their email.

## Quick Check (30 seconds)

1. Go to **Supabase Dashboard**
2. Click **Authentication** → **Providers** → **Email**
3. Look for **"Confirm email"** toggle

### If it's DISABLED:
- ✅ This is why no emails are sent
- ✅ Users can log in immediately after signup
- ✅ **This is actually working as designed!**

### If it's ENABLED:
- You need to configure SMTP (see full guide)

---

## Solution Option 1: Keep It Disabled (Recommended for Now)

**Fastest path** - Users can sign up and start using the app immediately:

1. Leave "Confirm email" **disabled** in Supabase
2. The signup page has been updated to handle this automatically
3. Users will be redirected to dashboard after signup

**What changed in the code:**
- Signup page now checks if user has a session
- If session exists → redirects to dashboard
- If no session → shows "check email" message

---

## Solution Option 2: Enable Email Confirmation (Production)

**For production** - Verify email addresses before allowing access:

### Step 1: Configure SMTP in Supabase

You're already using **Resend** for invitation emails, so use it here too:

1. Go to Supabase Dashboard → **Settings** → **Auth** → **SMTP Settings**
2. Enable **Custom SMTP**
3. Enter:
   ```
   Host: smtp.resend.com
   Port: 465
   Username: resend
   Password: [Your Resend API Key]
   Sender email: noreply@quotetree.ai
   Sender name: QuoteTree
   ```

### Step 2: Enable Email Confirmation

1. Go to **Authentication** → **Providers** → **Email**
2. **Enable** "Confirm email" toggle
3. Save

### Step 3: Test

1. Sign up with a test email
2. Check your email for confirmation link
3. Click link → should redirect to dashboard

---

## Files Updated

✅ `app/auth/signup/page.tsx` - Now handles both scenarios automatically

The signup page will now:
- Auto-detect if email confirmation is enabled or disabled
- Redirect to dashboard if disabled
- Show "check email" message if enabled

---

## Test It Now

1. Go to your signup page
2. Create a test account
3. **Expected behavior:**
   - If email confirmation disabled: Redirects to dashboard immediately ✅
   - If email confirmation enabled: Shows "check email" message ✅

---

## My Recommendation

**For development/testing:**
- Keep email confirmation **DISABLED**
- Faster testing, no email setup needed
- Users can test features immediately

**Before production launch:**
- Set up Resend SMTP properly
- Enable email confirmation
- Test the full flow

---

## Need the full troubleshooting guide?

See `FIX_SIGNUP_EMAIL_CONFIRMATION.md` for detailed steps on:
- Configuring SMTP
- Email templates
- Rate limiting
- Domain verification
- Testing checklist

---

## Summary

✅ **Code has been updated** - signup page now handles both scenarios
✅ **Most likely** your email confirmation is just disabled (this is normal!)
✅ **Quick fix** - Leave it disabled for now, users can start using app immediately
✅ **Production** - Set up SMTP and enable email confirmation later


