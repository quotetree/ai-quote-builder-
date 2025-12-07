# Proration Testing Guide

## Overview
This guide provides step-by-step instructions for testing the new SaaS proration logic for license additions and removals.

## Prerequisites
- Access to the application with admin/owner privileges
- An organization subscription (Individual or Organization plan)
- Stripe Dashboard access (optional, for verification)

## Test Scenarios

### Scenario 1: Add 1 License to Monthly Organization Plan

**Setup:**
- Current plan: Organization Monthly
- Current licenses: 2 (base) + 0 (additional) = 2 total
- Current price: $158/month
- Days into cycle: 15 out of 30

**Steps:**
1. Navigate to Dashboard → Billing Modal
2. Click "Manage" → "Edit plan"
3. Select "Organization" tab
4. Keep "Monthly" billing cycle selected
5. Click "+" button to increase additional licenses to 1
6. Click "Upgrade to Organization" button

**Expected Preview:**
```
Current Plan: Organization Monthly ($158/month)
New Plan: Organization Monthly ($237/month)

Upgrade Charge:
You'll be charged a prorated amount of $39.50 today for 1 additional 
license (15 days remaining in current period). Next billing date remains 
January 6, 2026 — renewal will be $237/month.
```

**Expected Results:**
- ✅ Preview shows prorated amount (~$39.50)
- ✅ "Billing date will reset" message NOT shown
- ✅ Next renewal date stays the same
- ✅ Clicking "Confirm Change" charges card immediately
- ✅ Modal shows success message
- ✅ Subscription updates to show 3 licenses
- ✅ Next billing amount shows $237/month

**Stripe Dashboard Verification:**
1. Go to Subscriptions → [Your Subscription]
2. Check "Billing cycle anchor" - should NOT have changed
3. Check latest invoice - should show prorated charge
4. Check "Upcoming invoice" - should show $237

---

### Scenario 2: Add 2 Licenses to Yearly Organization Plan

**Setup:**
- Current plan: Organization Yearly
- Current licenses: 2 (base) + 0 (additional) = 2 total
- Current price: $130/month ($1,560/year)
- Days into cycle: 180 out of 365

**Steps:**
1. Navigate to Dashboard → Billing Modal
2. Click "Manage" → "Edit plan"
3. Select "Organization" tab
4. Select "Yearly" billing cycle
5. Click "+" twice to set additional licenses to 2
6. Click "Upgrade to Organization" button

**Expected Preview:**
```
Current Plan: Organization Yearly ($130/month)
New Plan: Organization Yearly ($260/month)

Upgrade Charge:
You'll be charged a prorated amount of $768.00 today for 2 additional 
licenses (180 days remaining in current period). Next billing date remains 
December 6, 2026 — renewal will be $260/month.
```

**Calculation:**
- 2 new licenses × $65/month × 12 months = $1,560/year full price
- $1,560 × (180/365) = $768.00 prorated

**Expected Results:**
- ✅ Preview shows prorated amount (~$768)
- ✅ Billing anchor unchanged
- ✅ Immediate charge of $768
- ✅ Subscription shows 4 total licenses
- ✅ Next renewal shows $3,120/year ($260/month × 12)

---

### Scenario 3: Remove 1 License (Downgrade)

**Setup:**
- Current plan: Organization Monthly
- Current licenses: 2 (base) + 2 (additional) = 4 total
- Current price: $316/month

**Steps:**
1. Navigate to Dashboard → Billing Modal
2. Click "Manage" → "Edit plan"
3. Select "Organization" tab
4. Click "-" to reduce additional licenses to 1
5. Click "Upgrade to Organization" button

**Expected Preview:**
```
Current Plan: Organization Monthly ($316/month)
New Plan: Organization Monthly ($237/month)

Downgrade Scheduled:
1 license will be removed on January 6, 2026.
```

**Expected Results:**
- ✅ No immediate charge
- ✅ Shows "Downgrade Scheduled" banner
- ✅ Current subscription still shows 4 licenses
- ✅ Pending change indicator visible
- ✅ Can cancel the scheduled downgrade
- ✅ On January 6, 2026, subscription auto-updates to 3 licenses

---

### Scenario 4: Add 3 Licenses Mid-Month

**Setup:**
- Current plan: Organization Monthly
- Current licenses: 2 (base) + 0 (additional) = 2 total
- Current price: $158/month
- Days into cycle: 10 out of 30

**Steps:**
1. Navigate to Dashboard → Billing Modal
2. Click "Manage" → "Edit plan"
3. Set additional licenses to 3 (5 total licenses)
4. Click "Upgrade to Organization"

**Expected Calculation:**
- 3 new licenses × $79/month = $237/month full price
- $237 × (20/30) = $158 prorated

**Expected Preview:**
```
You'll be charged a prorated amount of $158.00 today for 3 additional 
licenses (20 days remaining in current period). Next billing date remains 
January 6, 2026 — renewal will be $395/month.
```

**Expected Results:**
- ✅ Prorated charge of $158
- ✅ Billing date unchanged
- ✅ Next renewal: $395/month (5 licenses)

---

### Scenario 5: Plan Type Change (NOT License-Only)

**Setup:**
- Current plan: Individual Monthly ($97/month)
- Switching to: Organization Monthly with 1 additional license

**Steps:**
1. Navigate to Dashboard → Billing Modal
2. Click "Manage" → "Edit plan"
3. Select "Organization" tab
4. Set additional licenses to 1
5. Click "Upgrade to Organization"

**Expected Preview:**
```
Current Plan: Individual Monthly ($97/month)
New Plan: Organization Monthly ($237/month)

Upgrade Charge:
You'll be charged $237.00 for the new monthly rate today. Your billing 
date will reset to today. Next renewal: January 6, 2026.
```

**Expected Results:**
- ✅ Full charge of $237 (NOT prorated)
- ✅ Shows "billing date will reset" message
- ✅ Billing anchor DOES change to today
- ✅ This is correct because it's a plan type change, not just licenses

---

### Scenario 6: Change from Monthly to Yearly (NOT License-Only)

**Setup:**
- Current plan: Organization Monthly with 1 additional license
- Current price: $237/month
- Switching to: Organization Yearly with 1 additional license

**Steps:**
1. Navigate to Dashboard → Billing Modal
2. Click "Manage" → "Edit plan"
3. Select "Organization" tab
4. Select "Yearly" billing cycle
5. Keep additional licenses at 1
6. Click "Upgrade to Organization"

**Expected Preview:**
```
Current Plan: Organization Monthly ($237/month)
New Plan: Organization Yearly ($195/month)

Upgrade Charge:
You'll be charged $2,340.00 for a full year today. Your billing date 
will reset to today. Next renewal: December 6, 2026.
```

**Calculation:**
- $195/month × 12 months = $2,340/year

**Expected Results:**
- ✅ Full year charge (NOT prorated)
- ✅ Billing anchor resets
- ✅ Next renewal in 1 year
- ✅ This is correct for cycle changes

---

## Edge Cases to Test

### Edge Case 1: Add License on Last Day of Cycle
- Current: 2 licenses, 1 day remaining
- Action: Add 1 license
- Expected: Prorated charge ≈ $2.63 (1/30 of $79)
- Billing anchor: Unchanged

### Edge Case 2: Add Multiple Licenses at Different Times
- Day 1: Add 1 license (charge prorated)
- Day 10: Add 1 more license (charge prorated again)
- Expected: Two separate invoices, billing anchor stays same both times

### Edge Case 3: Remove All Additional Licenses
- Current: 2 base + 3 additional = 5 total
- Action: Set additional to 0
- Expected: Downgrade scheduled, will return to base 2 licenses at period end

### Edge Case 4: Add Then Remove in Same Cycle
- Day 5: Add 2 licenses (immediate prorated charge)
- Day 15: Remove 1 license (scheduled for period end)
- Expected: Keep 3 licenses until period end, then drop to 2

---

## Verification Checklist

After each test, verify:

- [ ] Preview amount matches expected calculation
- [ ] Immediate charge appears on card (or scheduled for downgrades)
- [ ] Billing date remains unchanged (for license-only changes)
- [ ] Next renewal amount is correct
- [ ] Subscription in database updates correctly
- [ ] Stripe subscription shows correct items and quantities
- [ ] Invoice line items show proration details
- [ ] Upcoming invoice preview shows new total

---

## Common Issues & Troubleshooting

### Issue: Billing date changed when it shouldn't have
**Cause:** System didn't detect license-only change  
**Check:** 
- Verify plan type and cycle didn't change
- Check logs for "License-only change detected" message
- Verify `billingCycleAnchor` was set to "unchanged"

### Issue: Charged full amount instead of prorated
**Cause:** `prorationBehavior` not set correctly  
**Check:**
- Verify `proration_behavior: "create_prorations"` in Stripe API call
- Check subscription period dates are valid
- Verify calculation in preview matches actual charge

### Issue: Downgrade applied immediately instead of scheduled
**Cause:** License removal not recognized as downgrade  
**Check:**
- Verify new license count < current license count
- Check for "Downgrade Scheduled" in preview
- Verify `scheduled_for_period_end: true` in response

### Issue: Preview shows different amount than actual charge
**Cause:** Stripe proration rounding or timing differences  
**Check:**
- Small differences (<$1) are normal due to rounding
- Large differences indicate calculation error
- Check Stripe logs for actual proration calculation

---

## Automated Testing (Future)

Consider implementing:
1. **Unit tests** for proration calculations
2. **Integration tests** with Stripe test mode
3. **E2E tests** for full user flow
4. **Snapshot tests** for preview messages

---

## Support Documentation

When helping customers:
1. Explain proration clearly: "You only pay for the time you use"
2. Show the math: "X days remaining ÷ Y total days = Z%"
3. Emphasize billing date stays same: "Your renewal date won't change"
4. Clarify full vs. prorated: "Changing plans = full charge, adding licenses = prorated"

---

**Last Updated:** December 6, 2025  
**Version:** 1.0

