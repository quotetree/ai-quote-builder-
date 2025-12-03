# 🔥 CRITICAL FIX: Add Supabase Service Role Key

## 🚨 The Problem

The webhooks were **failing silently** because they don't have user authentication context (no `auth.uid()`). The database Row Level Security (RLS) was blocking all updates from webhooks.

## ✅ The Solution

Use the **Supabase Service Role Key** which bypasses RLS and allows webhooks to update the database.

---

## 📝 Steps to Fix

### 1. Get Your Service Role Key

1. Go to your **Supabase Dashboard**: https://supabase.com/dashboard
2. Select your project: **QuoteTree**
3. Go to **Settings** → **API**
4. Scroll down to **Project API keys**
5. Copy the **`service_role`** key (labeled "secret")
   - ⚠️ **WARNING:** This key bypasses RLS - keep it secret!
   - ❌ **NEVER** expose this in client-side code
   - ❌ **NEVER** commit this to Git

### 2. Add to `.env.local`

Open your `.env.local` file and add this line:

```bash
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

**Your `.env.local` should now have:**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here  # ← ADD THIS

STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_INDIVIDUAL_MONTHLY=price_...
STRIPE_PRICE_INDIVIDUAL_YEARLY=price_...
STRIPE_PRICE_ORG_BASE_MONTHLY=price_...
STRIPE_PRICE_ORG_BASE_YEARLY=price_...
STRIPE_PRICE_LICENSE_MONTHLY=price_...
STRIPE_PRICE_LICENSE_YEARLY=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_APP_URL=http://localhost:3002
```

### 3. Run the RLS Migration

Open **Supabase SQL Editor** and run:

```sql
-- File: supabase/migrations/20250127000000_fix_webhook_rls.sql
-- (Copy the contents from the migration file in your project)
```

Or just run this in the SQL Editor:

```sql
-- Grant necessary permissions to service role (used by webhooks)
GRANT ALL ON subscriptions TO service_role;
GRANT ALL ON organizations TO service_role;
GRANT ALL ON organization_memberships TO service_role;
GRANT ALL ON profiles TO service_role;
```

### 4. Restart Your Dev Server

```bash
# Kill the current server (Ctrl+C)
npm run dev
```

**Keep Stripe CLI running** in the other terminal:
```bash
stripe listen --forward-to localhost:3002/api/webhooks/stripe
```

---

## 🧪 Test Again

1. Go to http://localhost:3002
2. Sign in
3. Go to **Billing** → **Edit Plan**
4. Choose a plan and complete checkout
5. **Watch the dev server terminal** - you should see:
   ```
   Updating subscription with data: { ... }
   Subscription activated for organization xxx { plan_type: 'individual', status: 'active', ... }
   ```

6. **Check the database** with the SQL query:
   ```sql
   SELECT plan_type, status, stripe_subscription_id 
   FROM subscriptions 
   ORDER BY updated_at DESC 
   LIMIT 1;
   ```

   **You should see:**
   - ✅ `plan_type: "individual"` or `"organization"`
   - ✅ `status: "active"`
   - ✅ `stripe_subscription_id: "sub_..."`

7. **Reopen Billing modal** - should show your new plan!

---

## 🎯 What Changed

1. **Added `createServiceRoleClient()`** in `lib/supabase/server.ts`
2. **Updated webhook handler** to use service role client (bypasses RLS)
3. **Added detailed logging** to see exactly what's being updated
4. **Added `.select()` to updates** to verify they worked

---

## 🐛 If It Still Doesn't Work

1. **Check `.env.local`** - Is the service role key there?
2. **Restart dev server** - Changes to `.env.local` require restart
3. **Check dev server logs** - Look for the new detailed logs
4. **Share the logs** with me if you see errors

---

## ⚠️ Security Note

The service role key is **very powerful** and should **only** be used in:
- ✅ Server-side API routes (like webhooks)
- ✅ Server-side functions
- ✅ Trusted backend scripts

**NEVER use it in:**
- ❌ Client-side code
- ❌ Browser JavaScript
- ❌ Mobile apps

---

**Add the service role key now and test again!** 🚀

