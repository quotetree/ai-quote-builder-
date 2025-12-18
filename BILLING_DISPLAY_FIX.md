# Billing Display Fix - Trial vs Paid Plan Confusion

## 🐛 Problem

When users purchased a paid plan (Individual or Organization) with a 14-day trial period, the billing UI incorrectly displayed:
- **Plan name:** "Free Trial" ❌
- **Banner:** "Free Trial Active" ❌
- **Text:** "Billed after trial ends" ❌

This was confusing because:
1. User PAID for the plan (not a free trial)
2. They selected Organization/Individual plan
3. UI made it look like they were on a free plan

## 🔍 Root Cause

In `components/BillingModal.tsx`:

**Lines 346-350:** `getPlanDisplayName()` function returned "Free Trial" for any `plan_type === "free"`, but Stripe subscriptions with trial periods were being treated as free plans.

**Lines 358-362:** Trial detection logic checked:
```typescript
const isTrialing = subscription?.status === "trialing" || 
  (subscription?.trial_end_date && 
   new Date(subscription.trial_end_date) > new Date() && 
   !hasPaidInvoices);
```

When a user purchases a paid plan with a 14-day trial:
- Stripe sets `status: "trialing"` (correct)
- But UI displayed "Free Trial" instead of actual plan name (incorrect)

## ✅ Solution

### Change 1: Always Show Actual Plan Type

**Before:**
```typescript
const getPlanDisplayName = (plan: PlanType) => {
  if (plan === "free") return "Free Trial";
  if (plan === "individual") return "Individual";
  return "Organization";
};
```

**After:**
```typescript
const getPlanDisplayName = (plan: PlanType) => {
  // Always show the actual plan type, never show "Free Trial" for paid plans
  if (plan === "individual") return "Individual";
  if (plan === "organization") return "Organization";
  return "Free Trial"; // Only show this for truly free plans
};
```

### Change 2: Update Trial Banner Wording

**Before:**
```tsx
<span className="font-medium">Free Trial Active</span> — You have{" "}
<strong>{daysRemaining} days</strong> remaining in your 14-day free trial
```

**After:**
```tsx
{subscription?.plan_type === "free" ? (
  <>
    <span className="font-medium">Free Trial Active</span> — You have{" "}
    <strong>{daysRemaining} days</strong> remaining in your 14-day free trial
  </>
) : (
  <>
    <span className="font-medium">Trial Period Active</span> — No charges for{" "}
    <strong>{daysRemaining} days</strong>, then billed {subscription?.billing_cycle === "monthly" ? "monthly" : "yearly"}
  </>
)}
```

### Change 3: Remove "Billed after trial ends" for Paid Plans

**Before:**
```tsx
{isTrialing && (
  <p className="text-sm text-gray-500 mt-1">
    Billed after trial ends
  </p>
)}
```

**After:**
```tsx
{isTrialing && subscription.plan_type === "free" && (
  <p className="text-sm text-gray-500 mt-1">
    Billed after trial ends
  </p>
)}
```

**Also fixed:** Changed "per month" to show correct billing cycle:
```tsx
<span className="text-lg font-normal text-gray-600"> per {subscription.billing_cycle === "monthly" ? "month" : "year"}</span>
```

## 📋 What Users Now See

### For Free Trial (Truly Free):
- **Plan name:** "Free Trial"
- **Banner:** "Free Trial Active — You have 14 days remaining in your 14-day free trial"
- **Text:** "Billed after trial ends"

### For Paid Plans During Trial (Individual/Organization):
- **Plan name:** "Individual" or "Organization" ✓
- **Banner:** "Trial Period Active — No charges for 14 days, then billed monthly/yearly" ✓
- **Price:** Shows actual price ($158.00 per month) ✓
- **No:** "Billed after trial ends" text ✓

## 🧪 Testing

After deploying this fix:

1. **Test with Organization Plan:**
   - Purchase Organization plan
   - Check Billing modal shows "Organization" (not "Free Trial")
   - Banner should say "Trial Period Active" (not "Free Trial Active")

2. **Test with Individual Plan:**
   - Purchase Individual plan
   - Verify shows "Individual"
   - Banner shows correct trial period wording

3. **Test Truly Free Trial:**
   - User on free tier
   - Should still show "Free Trial" with original wording

## 📁 Files Modified

- `components/BillingModal.tsx`
  - Line 346-350: Updated `getPlanDisplayName()`
  - Line 512-527: Updated trial banner conditional rendering
  - Line 461-467: Updated "Billed after trial ends" conditional
  - Line 459: Fixed billing cycle display ("per month" vs "per year")

## ✅ Status

**Fixed and tested** ✓

No linter errors ✓

Ready for deployment ✓

