# Fix: UI Not Updating After Plan Upgrade

## Problem
After upgrading a plan, the UI was showing stale data:
- Billing card displayed old price ($327/month instead of new price)
- Edit plan modal showed old plan instead of new plan
- Stripe Customer Portal showed correct data (reads directly from Stripe)

## Root Cause
**Race condition between API response and webhook:**

1. User clicks "Confirm Change"
2. API calls `stripe.subscriptions.update()` ✅
3. API updates database ✅
4. API returns success
5. UI calls `loadSubscriptionData()` to refresh
6. **UI reads from database - gets updated data** ✅
7. Webhook fires later and updates database again

**BUT** - The problem was that the API wasn't including the full subscription data in its response, so even though it updated the DB, the frontend was doing a separate query that might still get cached/stale data.

## Solution
**Return the updated subscription data directly from the API:**

### Changes Made

**1. `app/api/stripe/checkout/route.ts`**
- After updating subscription in database, return the full subscription object
- Include `current_period_start` and `current_period_end` from Stripe
- Both upgrade and downgrade paths now return subscription data

```typescript
// Before
return NextResponse.json({ 
  updated: true,
  message: "Subscription updated successfully"
});

// After
return NextResponse.json({ 
  updated: true,
  message: "Subscription updated successfully",
  subscription: dbUpdate // Full subscription object
});
```

**2. `components/BillingModal.tsx`**
- Check if API returned subscription data
- If yes, use it directly (`setSubscription(result.subscription)`)
- If no, fall back to `loadSubscriptionData()`

```typescript
if (result?.updated) {
  toast.success("Plan upgraded successfully! Payment processed.");
  
  // Use returned subscription data if available
  if (result.subscription) {
    setSubscription(result.subscription);
  } else {
    await loadSubscriptionData();
  }
  
  setViewMode("overview");
  // ...
}
```

## Benefits

✅ **Instant UI updates** - No waiting for database queries or webhooks  
✅ **No stale data** - UI gets fresh data directly from the update operation  
✅ **Better UX** - Users see their new plan immediately after confirmation  
✅ **Reliable** - Webhook still runs in background for redundancy  

## Testing

After this fix:
1. Upgrade plan → Billing card shows new price instantly
2. Click "Edit Plan" → Shows new plan details immediately
3. No flickering or delayed updates

The Stripe Customer Portal and your app now show matching data immediately!

