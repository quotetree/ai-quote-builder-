# Fix: Signup Email Confirmation Not Working

## Problem
Users creating new trial accounts are not receiving confirmation emails from Supabase to verify their email and complete signup.

## Root Causes & Solutions

### ✅ Check 1: Email Confirmation Setting in Supabase

This is the most common issue!

1. Go to your **Supabase Dashboard**
2. Navigate to **Authentication** → **Providers** → **Email**
3. Look for **"Confirm email"** toggle
4. **Issue**: If this is **disabled**, users won't need to confirm emails (they can log in immediately)
5. **Solution**: 
   - If you WANT email confirmation: **Enable** this toggle
   - If you DON'T want email confirmation: This is expected behavior (see Option A below)

#### Option A: Disable Email Confirmation (Quick Fix)
If you want users to sign up instantly without email confirmation:

```typescript
// No code changes needed - just disable in Supabase Dashboard
// Users can log in immediately after signup
```

**Pros**: Faster signup flow, no email issues
**Cons**: Can't verify email addresses, potential spam accounts

#### Option B: Keep Email Confirmation Enabled (Recommended for Production)
If you want to verify emails, you need to ensure emails are being sent.

---

### ✅ Check 2: Email Provider Configuration

1. Go to **Authentication** → **Email Templates** in Supabase Dashboard
2. Check **"Enable Custom SMTP"** section
3. **Default**: Supabase uses their own SMTP (limited to development)
4. **For Production**: You MUST configure custom SMTP

#### Configure Custom SMTP (Required for production):

1. **Choose an email provider**:
   - **Resend** (recommended, what you're already using for invitations)
   - SendGrid
   - Mailgun
   - AWS SES

2. **Get SMTP credentials** from your provider

3. **Configure in Supabase**:
   - Go to **Settings** → **Auth** → **SMTP Settings**
   - Enable Custom SMTP
   - Enter your SMTP credentials

4. **Example for Resend** (since you're already using it):
   ```
   Host: smtp.resend.com
   Port: 465 or 587
   User: resend
   Password: [Your Resend API Key]
   Sender email: noreply@yourdomain.com
   Sender name: QuoteTree
   ```

---

### ✅ Check 3: Email Template Issues

1. Go to **Authentication** → **Email Templates**
2. Check the **"Confirm signup"** template
3. **Common issues**:
   - Missing `{{ .ConfirmationURL }}` token
   - Broken HTML
   - Wrong redirect URL

4. **Default template should contain**:
   ```html
   <h2>Confirm your signup</h2>
   <p>Follow this link to confirm your user:</p>
   <p><a href="{{ .ConfirmationURL }}">Confirm your email</a></p>
   ```

5. **Verify the redirect URL** in the template matches your app URL

---

### ✅ Check 4: Rate Limiting

Supabase limits emails in development:
- **Free plan**: Limited email sending
- **Rate limit**: Can't send too many emails in short time

**Solution**: 
1. Wait a few minutes between test signups
2. Upgrade to paid plan for production
3. Check Supabase logs for rate limit errors

---

### ✅ Check 5: Domain Verification (If using custom domain)

If you're using a custom domain for your app:

1. Go to **Authentication** → **URL Configuration**
2. Add your **production domain** to **Site URL**
3. Add your domain to **Redirect URLs**:
   ```
   https://yourdomain.com/auth/callback
   https://yourdomain.com/auth/accept-invite
   ```

---

### ✅ Check 6: Check Supabase Logs

1. Go to **Logs** → **Auth Logs** in Supabase Dashboard
2. Look for signup events
3. Check for errors like:
   - "Email sending failed"
   - "Rate limit exceeded"
   - "SMTP error"

---

## Quick Diagnostic Test

Run this test to see what's happening:

1. **Open browser console** (F12)
2. Go to your signup page
3. Try to sign up with a test email
4. **Check the response**:

```javascript
// The signup should return:
{
  data: {
    user: { ... },
    session: null  // ← Should be null if email confirmation required
  }
}

// If session is NOT null, email confirmation is disabled
```

5. **Check Supabase Dashboard** → **Authentication** → **Users**
   - If user appears with **"Waiting for verification"** badge → Emails not being sent
   - If user appears as **"Confirmed"** → Email confirmation is disabled

---

## Recommended Fix (Development)

For **development/testing**, I recommend disabling email confirmation:

1. Supabase Dashboard → **Authentication** → **Providers** → **Email**
2. **Disable** "Confirm email" toggle
3. Save changes
4. Now users can sign in immediately after signup

**Update signup page to handle this**:

```typescript
// app/auth/signup/page.tsx
const handleSignUp = async (e: React.FormEvent) => {
  e.preventDefault();
  setError(null);
  setMessage(null);
  setLoading(true);

  if (password !== confirmPassword) {
    setError("Passwords do not match");
    setLoading(false);
    return;
  }

  if (password.length < 6) {
    setError("Password must be at least 6 characters");
    setLoading(false);
    return;
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) throw error;

    // Check if email confirmation is required
    if (data.session) {
      // No email confirmation needed - user is logged in
      setMessage("Account created successfully! Redirecting...");
      setTimeout(() => {
        router.push("/dashboard");
      }, 1500);
    } else {
      // Email confirmation required
      setMessage(
        "Check your email for the confirmation link to complete signup."
      );
    }
  } catch (error: any) {
    setError(error.message);
  } finally {
    setLoading(false);
  }
};
```

---

## Recommended Fix (Production)

For **production**, you should verify emails:

1. **Configure Custom SMTP** (using Resend since you already have it):
   ```bash
   # Get your Resend API key from https://resend.com
   # Add to Supabase SMTP settings
   ```

2. **Enable email confirmation**:
   - Supabase Dashboard → Authentication → Email → Enable "Confirm email"

3. **Test thoroughly** before launching

4. **Monitor email delivery** in Resend dashboard

---

## Alternative: Auto-Login After Signup (No Email Confirmation)

If you want users to start using the app immediately:

```typescript
// app/auth/signup/page.tsx - Updated version
const handleSignUp = async (e: React.FormEvent) => {
  e.preventDefault();
  setError(null);
  setMessage(null);
  setLoading(true);

  if (password !== confirmPassword) {
    setError("Passwords do not match");
    setLoading(false);
    return;
  }

  if (password.length < 8) {
    setError("Password must be at least 8 characters");
    setLoading(false);
    return;
  }

  try {
    // Sign up
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (signUpError) throw signUpError;

    // If email confirmation is disabled, session will exist
    if (signUpData.session) {
      // User is automatically logged in
      router.push("/dashboard");
      return;
    }

    // If email confirmation is enabled
    setMessage(
      "Check your email for the confirmation link to complete signup."
    );
  } catch (error: any) {
    setError(error.message);
  } finally {
    setLoading(false);
  }
};
```

---

## Summary

**Quick Fix (5 minutes)**:
1. Supabase Dashboard → Authentication → Email Provider
2. **Disable** "Confirm email"
3. Users can now sign in immediately
4. Update signup page to redirect to dashboard on success

**Production Fix** (requires SMTP setup):
1. Configure custom SMTP (Resend recommended)
2. Enable email confirmation
3. Test email delivery
4. Monitor logs

---

## Testing Checklist

- [ ] Supabase email confirmation setting is configured as intended
- [ ] Custom SMTP is configured (if using email confirmation)
- [ ] Email template contains confirmation URL
- [ ] Site URL and redirect URLs are correct
- [ ] Test signup with real email
- [ ] Check Supabase Auth logs
- [ ] Verify user appears in Users table
- [ ] Test the complete flow: signup → email → confirm → login

---

## Need More Help?

1. **Check Supabase Auth Logs** - Most detailed error info
2. **Test with different email** - Sometimes provider blocks certain domains
3. **Check spam folder** - Emails might be filtered
4. **Verify SMTP credentials** - Wrong credentials = no emails
5. **Contact Supabase support** - If all else fails

---

## My Recommendation

**For now (development/testing)**:
- Disable email confirmation
- Let users sign in immediately
- Focus on testing other features

**Before production launch**:
- Set up Resend SMTP properly
- Enable email confirmation
- Test thoroughly
- Monitor email deliverability


