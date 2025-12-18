# Environment Variables Checklist for Production

## How to Check Vercel Environment Variables

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your **QuoteTree** project
3. Click **Settings** → **Environment Variables**
4. **IMPORTANT:** Make sure you're viewing the **Production** environment

## Required Variables

Copy this checklist and verify each variable:

### Supabase Configuration

- [ ] **NEXT_PUBLIC_SUPABASE_URL**
  - ✅ Format: `https://[project-id].supabase.co`
  - 🔍 Get it from: [Supabase Dashboard](https://app.supabase.com) → Your Project → Settings → API
  - ⚠️  Make sure it's your **production** project (not dev/staging)

- [ ] **NEXT_PUBLIC_SUPABASE_ANON_KEY**
  - ✅ Format: Starts with `eyJ`
  - 🔍 Get it from: Supabase Dashboard → Settings → API → Project API keys → `anon` `public`
  - ⚠️  Should be the anon key from your production project

- [ ] **SUPABASE_SERVICE_ROLE_KEY**
  - ✅ Format: Starts with `eyJ` (different from anon key)
  - 🔍 Get it from: Supabase Dashboard → Settings → API → Project API keys → `service_role` `secret`
  - ⚠️  This is a SECRET key - never expose in client code
  - ⚠️  Must be from production project

### Resend Configuration

- [ ] **RESEND_API_KEY**
  - ✅ Format: Starts with `re_` for live mode
  - 🔍 Get it from: [Resend Dashboard](https://resend.com/api-keys)
  - ⚠️  **CRITICAL:** Must be a production key (starts with `re_`)
  - ⚠️  Test keys won't work in production
  - 📝 Create new key if needed: Resend Dashboard → API Keys → Create API Key

### App URL

- [ ] **NEXT_PUBLIC_APP_URL**
  - ✅ Format: `https://quotetree.ai` (your production domain)
  - ❌ **NOT** `http://localhost:3000`
  - ❌ **NOT** a Vercel preview URL like `https://quotetree-xyz.vercel.app`
  - 📝 This is used in password reset email redirect links

### Stripe Configuration

- [ ] **STRIPE_SECRET_KEY**
  - ✅ Format: Starts with `sk_live_` for live mode
  - ❌ Should **NOT** start with `sk_test_` in production
  - 🔍 Get it from: [Stripe Dashboard](https://dashboard.stripe.com/apikeys) (make sure you're in **Live Mode**)
  - ⚠️  Toggle to "Live mode" in Stripe dashboard before copying

- [ ] **STRIPE_WEBHOOK_SECRET**
  - ✅ Format: Starts with `whsec_`
  - 🔍 Get it from: Stripe Dashboard → Developers → Webhooks → Your production endpoint
  - ⚠️  Each webhook endpoint has a unique signing secret
  - ⚠️  Test mode webhook secret is DIFFERENT from live mode
  - 📝 Make sure you're using the secret from your LIVE webhook endpoint

## Verification Script

Run this script locally to check your current environment:

```bash
# Make the script executable
chmod +x scripts/check-env-config.js

# Run the checker (uses your local .env file)
node scripts/check-env-config.js
```

**Note:** This checks your local environment. Vercel production may have different values!

## How to Update Variables in Vercel

### Method 1: Vercel Dashboard (Recommended)

1. Vercel Dashboard → Your Project → **Settings**
2. Click **Environment Variables**
3. Find the variable you need to update
4. Click the **...** menu → **Edit**
5. Update the value
6. **IMPORTANT:** Select **Production** environment
7. Click **Save**
8. **You MUST redeploy:** Go to **Deployments** → Click **...** on latest → **Redeploy**

### Method 2: Vercel CLI

```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Set a production environment variable
vercel env add RESEND_API_KEY production

# Then redeploy
vercel --prod
```

## Critical Notes

### ⚠️  After Changing ANY Environment Variable:

**YOU MUST REDEPLOY THE APPLICATION!**

Environment variables are baked into the deployment at build time. Changing them doesn't automatically update running deployments.

**Option 1: Trigger Redeploy in Vercel**
- Go to Deployments tab
- Click **...** on latest deployment
- Click **Redeploy**

**Option 2: Push a Commit**
```bash
git commit --allow-empty -m "Trigger redeploy after env var update"
git push
```

**Option 3: Use Vercel CLI**
```bash
vercel --prod
```

### 🔐 Security Notes

- Never commit these values to git
- Never expose service role keys in client code
- Keep Stripe live keys secure
- Rotate keys if accidentally exposed

### 🏷️ Environment Scopes

Vercel has three environment scopes:
- **Production**: Used for production deployments (quotetree.ai)
- **Preview**: Used for pull request previews
- **Development**: Used for local development

**Make sure variables are set for the Production environment!**

## Common Mistakes

### ❌ Mistake 1: Using Test Mode Keys
```bash
# WRONG for production:
STRIPE_SECRET_KEY=sk_test_...  # Test mode
RESEND_API_KEY=re_test_...     # Test API

# CORRECT for production:
STRIPE_SECRET_KEY=sk_live_...  # Live mode
RESEND_API_KEY=re_...          # Live API (no "test" prefix)
```

### ❌ Mistake 2: Using Development URLs
```bash
# WRONG for production:
NEXT_PUBLIC_APP_URL=http://localhost:3000

# CORRECT for production:
NEXT_PUBLIC_APP_URL=https://quotetree.ai
```

### ❌ Mistake 3: Using Wrong Supabase Project
```bash
# WRONG - dev project URL:
NEXT_PUBLIC_SUPABASE_URL=https://dev-project.supabase.co

# CORRECT - production project URL:
NEXT_PUBLIC_SUPABASE_URL=https://prod-project.supabase.co
```

### ❌ Mistake 4: Forgetting to Redeploy
After updating variables, you MUST redeploy or changes won't take effect!

## Quick Test

After verifying/updating all variables:

1. **Trigger a redeploy** (critical!)
2. **Wait for deployment to complete**
3. **Test the checkout flow:**
   - Go to https://quotetree.ai
   - Start a trial checkout
   - Complete with a real email
   - Check email inbox (and spam folder)

4. **Check logs if emails don't arrive:**
   - Vercel Dashboard → Functions → Logs
   - Look for "Password setup email sent" and "Welcome email sent"
   - Check for any error messages

## Still Not Working?

If emails still aren't being sent after verifying all variables:

1. **Check Vercel Function Logs** (most important!)
   - Go to Vercel → Functions → `/api/webhooks/stripe`
   - Look for actual error messages in the logs

2. **Check Stripe Webhook Logs**
   - Verify webhook is firing
   - Verify it returns 200 (not 400 or 500)

3. **Check Resend Domain Verification**
   - Resend Dashboard → Domains
   - Make sure `quotetree.ai` is verified

4. **Check Supabase Auth Logs**
   - Look for password reset email attempts
   - Check for rate limiting or delivery errors

5. **Follow the complete troubleshooting guide**
   - See: `LIVE_MODE_EMAIL_TROUBLESHOOTING.md`

## Need Help?

If you've verified all variables and emails still aren't working, check:

1. `LIVE_MODE_EMAIL_TROUBLESHOOTING.md` - Complete diagnostic guide
2. Vercel function logs - Actual error messages
3. Stripe webhook response - Is webhook even firing?
4. Resend logs - Are API calls being made?
5. Supabase logs - Are emails being attempted?

