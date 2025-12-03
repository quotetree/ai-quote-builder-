# 🧪 Stripe Integration Testing Guide

## ✅ What We Fixed

1. **Webhook Handler Errors** - Fixed two critical bugs:
   - Removed `total_licenses` from updates (it's a generated column)
   - Added null-checking for `current_period_start`/`end` timestamps

2. **Success Redirect** - Added success message on dashboard after checkout

---

## 🔍 Step 1: Verify Database is Updated

**Run this SQL in Supabase SQL Editor:**

```sql
SELECT 
  s.id as subscription_id,
  s.organization_id,
  s.plan_type,
  s.billing_cycle,
  s.status,
  s.base_licenses,
  s.additional_licenses,
  s.total_licenses,
  s.stripe_subscription_id,
  s.current_period_start,
  s.current_period_end,
  s.trial_end_date,
  s.updated_at,
  o.name as organization_name
FROM subscriptions s
JOIN organizations o ON o.id = s.organization_id
ORDER BY s.updated_at DESC
LIMIT 5;
```

**What to look for:**
- ✅ `plan_type` should be `"individual"` or `"organization"` (not `"free"`)
- ✅ `status` should be `"active"` (not `"trialing"`)
- ✅ `stripe_subscription_id` should be filled in (e.g., `sub_1Sa4XYRiMM33f0novYZrS8nE`)
- ✅ `billing_cycle` should be `"monthly"` or `"yearly"`
- ✅ `current_period_start` and `current_period_end` should have dates

---

## 🧪 Step 2: Test Complete Checkout Flow

### A. Start Fresh

1. Open **Incognito/Private Window** (to avoid cache issues)
2. Go to http://localhost:3002
3. Sign in to your QuoteTree account

### B. Make a Purchase

1. Click your profile → **Billing**
2. Click **Manage** → **Edit Plan**
3. Select **Individual** or **Organization**
4. Choose **Yearly** or **Monthly**
5. Click **"Upgrade to Individual"** or **"Upgrade to Organization"**

### C. Complete Stripe Checkout

1. Use test card: **4242 4242 4242 4242**
2. Enter any future expiration date
3. Enter any 3-digit CVC
4. Enter any billing address
5. Click **Subscribe**

### D. Verify Success

**You should see:**
- ✅ Redirected back to dashboard
- ✅ Green success toast: "🎉 Payment successful! Your [Plan] is now active."
- ✅ Stripe CLI shows **all [200]** responses (no [500] errors)

### E. Check Updated Plan

1. Wait **5 seconds** for webhooks to process
2. Click profile → **Billing** again
3. **IMPORTANT:** The modal should reload fresh data

**You should see:**
- ✅ Plan name changed from "Free Trial" to "Individual" or "Organization"
- ✅ Price displayed (e.g., "$79/month")
- ✅ Billing cycle displayed (e.g., "Billed yearly")
- ✅ "Active" status (not "Free Trial Active")

---

## 🐛 If Plan Still Shows "Free Trial"

### Issue 1: Modal Not Reloading

**Symptom:** Modal opens with old data from before purchase

**Fix:** Close and reopen the Billing modal
- Click **X** to close
- Click profile → **Billing** to reopen
- The modal's `useEffect` should fetch fresh data

**If still showing old data:**
1. **Hard refresh:** Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
2. **Clear browser cache** for localhost:3002
3. **Try a different browser** or incognito window

### Issue 2: Database Wasn't Updated

**Symptom:** SQL query shows `plan_type: "free"` still

**Debug Steps:**

1. **Check Stripe CLI** - Did all webhooks return [200]?
   ```
   ✅ customer.subscription.created [200]
   ✅ customer.subscription.updated [200]
   ✅ checkout.session.completed [200]
   ```

2. **Check Dev Server Logs** - Any errors?
   ```
   ✅ Subscription sub_xxx updated
   ✅ Subscription activated for organization xxx
   ```

3. **Check Stripe Dashboard**
   - Go to https://dashboard.stripe.com/test/subscriptions
   - Find your subscription
   - Verify it's "Active"
   - Copy the subscription ID (starts with `sub_`)

4. **Manually Check Database**
   ```sql
   SELECT * FROM subscriptions 
   WHERE stripe_subscription_id = 'sub_YOUR_ID_HERE';
   ```

### Issue 3: Wrong Organization

**Symptom:** Subscription updated for different organization

**Check:**
```sql
-- Find YOUR organization ID
SELECT 
  o.id as org_id,
  o.name,
  o.owner_id,
  u.email
FROM organizations o
JOIN auth.users u ON u.id = o.owner_id
WHERE u.email = 'YOUR_EMAIL@example.com';

-- Check which subscription you're seeing
SELECT s.*, o.name 
FROM subscriptions s
JOIN organizations o ON o.id = s.organization_id
WHERE o.owner_id = (
  SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL@example.com'
);
```

---

## 🔄 Step 3: Test Another Purchase (If Needed)

If the first attempt didn't work, try again:

1. **Restart both terminals:**
   - Kill `npm run dev` (Ctrl+C)
   - Kill `stripe listen` (Ctrl+C)
   - Start again:
     ```bash
     npm run dev
     stripe listen --forward-to localhost:3002/api/webhooks/stripe
     ```

2. **Make another purchase** with the flow above
3. **Watch the terminals** for any errors
4. **Check the database** immediately after

---

## 📊 Expected Stripe CLI Output

```
--> checkout.session.completed [evt_xxx]
<-- [200] POST http://localhost:3002/api/webhooks/stripe
--> customer.subscription.created [evt_xxx]
<-- [200] POST http://localhost:3002/api/webhooks/stripe
--> customer.subscription.updated [evt_xxx]
<-- [200] POST http://localhost:3002/api/webhooks/stripe
--> invoice.payment_succeeded [evt_xxx]
<-- [200] POST http://localhost:3002/api/webhooks/stripe
```

**All should be [200]!** If you see any [500], there's still an error.

---

## 📧 What to Share if It's Still Not Working

1. **Screenshot of Stripe CLI** showing the webhooks
2. **Screenshot of dev server** terminal showing logs
3. **SQL query result** from Step 1 above
4. **Screenshot of Billing modal** showing "Free Trial" still

---

## 🎉 Success Criteria

✅ Stripe checkout completes  
✅ Redirects back to dashboard with success message  
✅ All webhooks return [200]  
✅ Database shows `plan_type: "individual"` or `"organization"`  
✅ Database shows `status: "active"`  
✅ Billing modal shows new plan name and price  
✅ No more "Free Trial Active" message  

---

**Ready to test? Let's do it!** 🚀

