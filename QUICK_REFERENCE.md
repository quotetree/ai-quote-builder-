# SaaS Proration - Quick Reference

## TL;DR

**What Changed:** When users add licenses (e.g., 2 → 3), we now prorate the charge based on remaining days instead of charging a full period and resetting the billing date.

**Example:** Add 1 license mid-cycle → Charge $39.50 (prorated) instead of $237 (full month)

---

## Key Rules

### ✅ DO Prorate & Keep Billing Date
- Adding licenses to same plan type and cycle
- User charges: Prorated amount only
- Billing anchor: **UNCHANGED**
- Example: Organization Monthly 2 → 3 licenses

### ⚠️ DON'T Prorate (Full Charge)
- Changing plan type (Individual → Organization)
- Changing billing cycle (Monthly → Yearly)
- Billing anchor: **RESET TO TODAY**

### ❌ No Immediate Charge (Schedule for Later)
- Removing licenses (downgrade)
- Takes effect at period end
- Billing anchor: **UNCHANGED**

---

## Code Snippets

### Detect License-Only Change
```typescript
const isLicenseOnlyChange = (
  currentPlan === newPlan &&
  currentCycle === newCycle &&
  currentPlan === "organization" &&
  currentLicenses !== newLicenses
);
```

### Calculate Proration
```typescript
const totalDays = Math.ceil((periodEnd - periodStart) / (1000 * 60 * 60 * 24));
const remainingDays = Math.max(1, Math.ceil((periodEnd - now) / (1000 * 60 * 60 * 24)));
const remainingFraction = totalDays > 0 ? remainingDays / totalDays : 1;

const prorationAmount = Math.round(
  (pricePerLicensePerCycle * licenseDiff) * remainingFraction
);
```

### Update Stripe Subscription
```typescript
// For license-only changes:
{
  items: [{ id: existingItemId, quantity: newQuantity }],
  proration_behavior: "create_prorations",
  billing_cycle_anchor: "unchanged",
  // DON'T set billing_cycle_anchor: "now"
}
```

---

## API Endpoints

### Preview Proration
```bash
POST /api/stripe/preview-proration
{
  "planType": "organization",
  "billingCycle": "monthly",
  "additionalLicenses": 1
}

Response:
{
  "prorationAmount": 3950,          # $39.50 in cents
  "isUpgrade": true,
  "requiresCheckout": true,
  "resetsBillingAnchor": false,     # Key field!
  "billingMessage": "You'll be charged a prorated amount..."
}
```

### Update Subscription
```bash
POST /api/stripe/checkout
{
  "planType": "organization",
  "billingCycle": "monthly",
  "additionalLicenses": 1,
  "forceCheckout": false
}

Response:
{
  "updated": true,
  "subscriptionId": "sub_xxx",
  "message": "Subscription updated successfully",
  "subscription": { ... }
}
```

---

## Testing One-Liner

```bash
# Test adding 1 license to org plan
curl -X POST http://localhost:3003/api/stripe/preview-proration \
  -H "Content-Type: application/json" \
  -d '{"planType":"organization","billingCycle":"monthly","additionalLicenses":1}' \
  | jq '.prorationAmount, .resetsBillingAnchor'

# Should output:
# 3950 (or similar prorated amount)
# false (billing anchor NOT reset)
```

---

## Troubleshooting

### Problem: Billing date changed when it shouldn't
**Check:** `resetsBillingAnchor` should be `false` for license-only changes  
**Fix:** Verify `isLicenseOnlyChange` detection logic

### Problem: Charged full amount instead of prorated
**Check:** `proration_behavior` should be `"create_prorations"`  
**Fix:** Verify Stripe API call parameters

### Problem: Preview shows different amount than actual
**Check:** Period dates are valid, Stripe proration calculation  
**Expected:** Small differences (<$1) due to to-the-second accuracy

---

## Math Examples

### Monthly Plan (30-day cycle)
```
Current: 2 licenses @ $79/mo = $158
Add: 1 license on day 16 (15 days remaining)

Calculation:
$79 × (15 ÷ 30) = $79 × 0.5 = $39.50

Immediate charge: $39.50
Next renewal: $237 (3 licenses)
```

### Yearly Plan (365-day cycle)
```
Current: 2 licenses @ $65/mo = $130/mo ($1,560/year)
Add: 2 licenses on day 180 (185 days remaining)

Calculation:
2 licenses × $65/mo × 12 months = $1,560/year
$1,560 × (185 ÷ 365) = $1,560 × 0.507 = $790.92

Immediate charge: $790.92
Next renewal: $3,120/year (4 licenses @ $65/mo × 12)
```

---

## Important Constants

```typescript
// From types/database.ts
PLAN_PRICING = {
  organization: {
    monthly: {
      base: 15800,              // $158 for 2 licenses
      perAdditionalLicense: 7900 // $79 per license
    },
    yearly: {
      base: 13000,              // $130/mo for 2 licenses
      perAdditionalLicense: 6500 // $65/mo per license
    },
    baseLicenses: 2
  }
}
```

---

## Decision Tree (Simplified)

```
User changes subscription
    ↓
Same plan & cycle?
    ↓
  YES → Organization plan?
    ↓
  YES → License count changed?
    ↓
  YES → LICENSE-ONLY CHANGE
    ↓
  Adding licenses?
    ↓
  YES → ✅ Prorate, Keep Anchor
  NO  → ❌ Schedule, Keep Anchor
```

---

## Stripe Proration Behaviors

| Behavior | Use Case | Effect |
|----------|----------|--------|
| `"create_prorations"` | License quantity changes | Stripe calculates prorated charges automatically |
| `"always_invoice"` | Plan upgrades (yearly) | Always create invoice for difference |
| `"none"` | Plan type/cycle changes | No proration, charge full new amount |

---

## Links to Full Documentation

- **Technical Details:** `SAAS_PRORATION_IMPLEMENTATION.md`
- **Testing Guide:** `PRORATION_TESTING_GUIDE.md`
- **Visual Diagrams:** `SAAS_PRORATION_DIAGRAMS.md`
- **Summary:** `SAAS_PRORATION_SUMMARY.md`

---

## Git Commands

```bash
# View changes
git diff main -- app/api/stripe/preview-proration/route.ts
git diff main -- app/api/stripe/checkout/route.ts

# Stage files
git add app/api/stripe/preview-proration/route.ts
git add app/api/stripe/checkout/route.ts
git add *.md

# Commit (use COMMIT_MESSAGE.txt)
git commit -F COMMIT_MESSAGE.txt

# Push
git push origin feature/saas-proration-logic
```

---

**Branch:** `feature/saas-proration-logic`  
**Status:** ✅ Ready for Review  
**Impact:** License additions now prorate correctly  
**Breaking Changes:** None (backward compatible)

