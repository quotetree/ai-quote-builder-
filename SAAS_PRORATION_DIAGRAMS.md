# SaaS Proration - Visual Flow Diagrams

## Before (Incorrect Behavior) ❌

```
User starts with 2 licenses
┌─────────────────────────────────────────────────────────┐
│ Day 1: Subscribe                                         │
│ • 2 licenses @ $79/mo = $158/month                      │
│ • Billing date: Jan 1                                   │
│ • Next renewal: Feb 1 ($158)                            │
└─────────────────────────────────────────────────────────┘
           │
           │ 15 days pass...
           ▼
┌─────────────────────────────────────────────────────────┐
│ Day 16: User adds 1 license ❌ WRONG                     │
│ • Charged immediately: $237 (FULL MONTH!)               │
│ • Billing date: Jan 16 (RESET!)                         │
│ • Next renewal: Feb 16 ($237)                           │
│                                                          │
│ Problems:                                                │
│ • User paid for 16 days twice                           │
│ • Billing date changed unexpectedly                     │
│ • Renewal date now different from original              │
└─────────────────────────────────────────────────────────┘
```

## After (Correct Behavior) ✅

```
User starts with 2 licenses
┌─────────────────────────────────────────────────────────┐
│ Day 1: Subscribe                                         │
│ • 2 licenses @ $79/mo = $158/month                      │
│ • Billing date: Jan 1                                   │
│ • Next renewal: Feb 1 ($158)                            │
└─────────────────────────────────────────────────────────┘
           │
           │ 15 days pass...
           ▼
┌─────────────────────────────────────────────────────────┐
│ Day 16: User adds 1 license ✅ CORRECT                   │
│ • Charged immediately: $39.50 (PRORATED!)               │
│   Calculation: $79 × (15 days / 30 days) = $39.50      │
│ • Billing date: Jan 1 (UNCHANGED!)                      │
│ • Next renewal: Feb 1 ($237)                            │
│                                                          │
│ Benefits:                                                │
│ • User only pays for time used                          │
│ • Billing date stays consistent                         │
│ • Predictable renewal date                              │
└─────────────────────────────────────────────────────────┘
```

---

## Proration Calculation Examples

### Example 1: Monthly Plan, Mid-Cycle

```
Timeline:
├─────────────────────────────┬──────────────────┤
Jan 1                      Jan 16             Feb 1
├─ 15 days passed ──────────┼─ 15 days left ──┤
                            ADD 1 LICENSE

Current State:
• 2 licenses @ $79/mo = $158/month
• 15 days remaining out of 30 total

Proration Calculation:
• New license cost per month: $79
• Remaining fraction: 15/30 = 0.5
• Prorated charge: $79 × 0.5 = $39.50

Immediate Charge: $39.50
Next Renewal (Feb 1): $237 (3 licenses @ $79)
```

### Example 2: Yearly Plan, Mid-Year

```
Timeline:
├─────────────────────────────┬──────────────────┤
Dec 1, 2024                Jun 1, 2025      Dec 1, 2025
├─ 180 days passed ─────────┼─ 185 days left ──┤
                            ADD 2 LICENSES

Current State:
• 2 licenses @ $65/mo = $130/month ($1,560/year)
• 185 days remaining out of 365 total

Proration Calculation:
• New license cost per year: $65/mo × 12 = $780/year each
• 2 licenses: $780 × 2 = $1,560
• Remaining fraction: 185/365 ≈ 0.507
• Prorated charge: $1,560 × 0.507 = $790.92

Immediate Charge: $790.92
Next Renewal (Dec 1, 2025): $3,120 (4 licenses @ $65/mo × 12)
```

### Example 3: Multiple License Additions

```
Scenario: User adds licenses at different times

Day 1 (Jan 1): Subscribe
• 2 licenses
• Price: $158/month
• Next renewal: Feb 1

Day 10 (Jan 10): Add 1 license
• 21 days remaining
• Charge: $79 × (21/30) = $55.30
• Next renewal: Feb 1 → $237

Day 20 (Jan 20): Add 1 more license
• 11 days remaining
• Charge: $79 × (11/30) = $28.97
• Next renewal: Feb 1 → $316

Total Immediate Charges: $55.30 + $28.97 = $84.27
Feb 1 Renewal: $316 (4 licenses @ $79)
```

---

## License Removal (Downgrade)

```
User has 4 licenses
┌─────────────────────────────────────────────────────────┐
│ Current State                                            │
│ • 4 licenses (2 base + 2 additional)                    │
│ • Price: $316/month                                     │
│ • Next renewal: Feb 1                                   │
└─────────────────────────────────────────────────────────┘
           │
           │ Day 16: Remove 1 license
           ▼
┌─────────────────────────────────────────────────────────┐
│ Downgrade Scheduled ✅                                   │
│ • No immediate charge/credit                            │
│ • Change scheduled for: Feb 1                           │
│ • Until Feb 1: Still have 4 licenses ($316/month)      │
│ • After Feb 1: 3 licenses ($237/month)                 │
│                                                          │
│ Why no immediate credit?                                │
│ • User already paid for current period                  │
│ • Removing licenses = downgrade (wait for period end)   │
│ • Adding licenses = upgrade (charge prorated)           │
└─────────────────────────────────────────────────────────┘
```

---

## Decision Tree

```
User wants to change subscription
         │
         ▼
    [Detect Change Type]
         │
    ┌────┴────┐
    │         │
    ▼         ▼
Plan/Cycle  License
  Change    Quantity
            Change
    │         │
    │         ▼
    │    [Same Plan?]
    │    [Same Cycle?]
    │         │
    │    ┌────┴────┐
    │    │         │
    │   YES       NO
    │    │         │
    │    ▼         │
    │ LICENSE      │
    │  ONLY        │
    │  CHANGE      │
    │    │         │
    │    ▼         │
    │ [Adding?]    │
    │    │         │
    │ ┌──┴──┐      │
    │ │     │      │
    │YES   NO      │
    │ │     │      │
    │ ▼     ▼      │
    │ADD  REMOVE   │
    └──┬────┬──────┘
       │    │
       ▼    ▼
    ┌──────────────────────────────┐
    │ ADD LICENSES (Upgrade)        │
    ├───────────────────────────────┤
    │ ✅ Prorate charge             │
    │ ✅ Keep billing anchor        │
    │ ✅ Keep renewal date          │
    │ ⚡ Immediate effect           │
    └───────────────────────────────┘

    ┌──────────────────────────────┐
    │ REMOVE LICENSES (Downgrade)   │
    ├───────────────────────────────┤
    │ ❌ No charge/credit           │
    │ ✅ Keep billing anchor        │
    │ ✅ Keep renewal date          │
    │ 🕐 Scheduled for period end   │
    └───────────────────────────────┘

    ┌──────────────────────────────┐
    │ PLAN/CYCLE CHANGE             │
    ├───────────────────────────────┤
    │ ⚠️  Full charge OR prorate    │
    │ ⚠️  May reset billing anchor  │
    │ ⚠️  May change renewal date   │
    │ 📋 Depends on specific change │
    └───────────────────────────────┘
```

---

## API Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. User clicks "Add License" button                      │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Frontend calls fetchProrationPreview()                │
│    POST /api/stripe/preview-proration                    │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Backend detects license-only change                   │
│    • currentPlan === newPlan ✓                          │
│    • currentCycle === newCycle ✓                        │
│    • currentLicenses !== newLicenses ✓                  │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Calculate proration                                   │
│    • Get current_period_start, current_period_end       │
│    • Calculate remaining days                           │
│    • Amount = pricePerLicense × licenseDiff × fraction  │
│    • Set resetsBillingAnchor = false                    │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Return preview to frontend                            │
│    {                                                     │
│      prorationAmount: 3950,  // $39.50 in cents         │
│      isUpgrade: true,                                    │
│      requiresCheckout: true,                             │
│      resetsBillingAnchor: false,                         │
│      billingMessage: "You'll be charged..."             │
│    }                                                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 6. Show confirmation modal                               │
│    "You'll be charged $39.50 today for 1 additional     │
│     license. Next billing date remains Jan 1."          │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼ User clicks "Confirm"
┌─────────────────────────────────────────────────────────┐
│ 7. Frontend calls createCheckoutSession()                │
│    POST /api/stripe/checkout                             │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 8. Backend updates Stripe subscription                   │
│    • Detect license-only change again                    │
│    • Update existing item quantity (don't delete)       │
│    • Set proration_behavior: "create_prorations"        │
│    • Set billing_cycle_anchor: "unchanged"              │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 9. Stripe processes update                               │
│    • Creates prorated invoice                            │
│    • Charges payment method                              │
│    • Keeps billing cycle anchor                          │
│    • Updates subscription quantity                       │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 10. Update database                                      │
│     • additional_licenses = 1                            │
│     • total_licenses = 3                                 │
│     • additional_license_price_cents = 7900             │
│     • Keep current_period_start/end unchanged           │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 11. Show success message                                 │
│     "Plan upgraded successfully! Payment processed."     │
└─────────────────────────────────────────────────────────┘
```

---

## Comparison Table

| Aspect | Before ❌ | After ✅ |
|--------|-----------|----------|
| **Charge Amount** | Full new month ($237) | Prorated ($39.50) |
| **Billing Date** | Reset to today | Unchanged |
| **Renewal Date** | Changes to today + 1 month | Stays at original date |
| **Next Renewal** | 1 month from today | Original renewal date |
| **User Experience** | Confusing, unexpected | Clear, predictable |
| **SaaS Standard** | ❌ Non-standard | ✅ Industry standard |

---

## Code Logic Flow

```typescript
// 1. DETECT LICENSE-ONLY CHANGE
const isLicenseOnlyChange = (
  currentPlan === newPlan &&        // Same plan type
  currentCycle === newCycle &&      // Same billing cycle
  currentPlan === "organization" && // Organization plan
  currentLicenses !== newLicenses   // Different license count
);

// 2. IF LICENSE-ONLY CHANGE
if (isLicenseOnlyChange) {
  // 3. CALCULATE PRORATION
  const remainingFraction = remainingDays / totalDays;
  const prorationAmount = pricePerLicense × licenseDiff × remainingFraction;
  
  // 4. KEEP BILLING ANCHOR
  resetsBillingAnchor = false;
  billingCycleAnchor = "unchanged";
  
  // 5. USE PROPER PRORATION
  prorationBehavior = "create_prorations";
  
  // 6. UPDATE QUANTITY (DON'T DELETE/RECREATE)
  itemUpdates.push({ id: existingItemId, quantity: newQuantity });
}

// 7. OTHERWISE (PLAN/CYCLE CHANGE)
else {
  // Full charge, may reset anchor, delete/recreate items
  // ... existing logic ...
}
```

---

**Legend:**
- ✅ = Correct behavior
- ❌ = Incorrect behavior  
- ⚠️ = Depends on scenario
- 🕐 = Scheduled for later
- ⚡ = Immediate effect
- 📋 = See documentation

