# Debug: Extraction and Matching Pipeline

**Date:** November 19, 2025  
**Status:** Active debugging for "1-year vs 5-year" issue

## 🚨 Problem Being Solved

Despite implementing hard constraint enforcement for durations, the system was **still suggesting 5-year licenses when users explicitly asked for 1-year**. This document details the comprehensive debugging added to diagnose and fix this critical issue.

---

## 🔍 Debugging Strategy

### Phase 1: LLM Extraction Debugging

**What we log:**
```typescript
console.log('🧠 Phase 1: Extracting structured items from user message...');
console.log(`   User message: "${message}"`);
const extractedItems = await extractRequestedItems(message, conversationState, openai);
console.log('✅ Extracted items:', extractedItems.map(i => `${i.quantity || 1}x ${i.item} (${i.duration || 'no duration'})`));
console.log('📋 DEBUG: Full extracted items:', JSON.stringify(extractedItems, null, 2));
```

**Why this matters:**
- Confirms whether the LLM is correctly parsing "1 year" → `duration: "1-year"`
- Shows if duration is being lost during quantity parsing (e.g., "(5) 1 year")
- Validates that the extraction prompt improvements are working

### Phase 2: Matching Pipeline Debugging

For each requested item, we now log:

#### A. Initial Keywords and Constraints
```typescript
console.log(`\n🔍 Matching item: ${request.item}${request.duration ? ` (${request.duration})` : ''}`);
console.log(`   Keywords: ${keywords}`);
console.log(`   Duration constraint: ${request.duration || 'none'}`);
```

#### B. Top 5 Candidates BEFORE Hard Constraints
```typescript
console.log(`\n   📊 Top 5 candidates BEFORE hard constraints:`);
results.slice(0, 5).forEach((r, idx) => {
  const searchText = buildSearchText(r.product);
  console.log(`      ${idx + 1}. "${r.product.product_name}" (score: ${r.score})`);
  console.log(`         SearchText: ${searchText.substring(0, 120)}...`);
});
```

**Critical diagnostic:** This shows whether:
- The 1-year product is in the keyword search results at all
- The 1-year product's `searchText` actually contains "1 year" / "1-year"
- The 5-year product is scoring higher due to keyword matches

#### C. Duration Constraint Application
```typescript
if (request.duration) {
  const durationVariants = normalizeDuration(request.duration);
  console.log(`\n   🔒 Applying duration constraint: ${durationVariants.join(', ')}`);
}
```

Shows the exact variants being searched for:
- `"1-year"` → `["1-year", "1 year", "1year", "1 yr", "1-yr"]`

#### D. Hard Constraint Failures (Top 3 only)
```typescript
const validResults = results.filter(result => {
  const passes = meetsHardConstraints(result.product, request);
  if (!passes && results.indexOf(result) < 3) {
    console.log(`      ❌ "${result.product.product_name}" failed hard constraints`);
  }
  return passes;
});
```

**Why only top 3?** Avoids log spam while showing the most relevant failures.

#### E. Final Result Summary
```typescript
console.log(`\n   ✅ Result: ${results.length} keyword matches → ${validResults.length} after hard constraints`);
```

Confirms how many products were filtered out by duration requirements.

---

## 🔧 Enhanced Hard Constraint Checking

Updated `meetsHardConstraints` to provide detailed diagnostics:

```typescript
function meetsHardConstraints(product: any, item: EnhancedRequestedItem, verbose: boolean = false): boolean {
  const searchText = buildSearchText(product);
  
  if (item.duration) {
    const durationVariants = normalizeDuration(item.duration);
    const hasDuration = durationVariants.some(variant => searchText.includes(variant));
    
    if (verbose || !hasDuration) {
      console.log(`   ${hasDuration ? '✓' : '✗'} Product: "${product.product_name}"`);
      console.log(`      Duration required: ${item.duration}`);
      console.log(`      Variants checked: [${durationVariants.join(', ')}]`);
      console.log(`      SearchText: "${searchText.substring(0, 150)}..."`);
      console.log(`      Result: ${hasDuration ? 'PASS' : 'FAIL'}`);
    }
    
    if (!hasDuration) {
      return false;
    }
  }
  
  return true;
}
```

**Key improvements:**
- Shows exact product being evaluated
- Lists all duration variants being checked
- Shows the full searchText for the product (truncated to 150 chars)
- Clear PASS/FAIL result

---

## 📊 "Top 3 Close Matches" Feature

When no exact match is found (due to hard constraints or low scores), we now show the **top 3 closest alternatives** WITHOUT auto-adding them.

### Scenario 1: Duration Constraint Not Met

**Example:** User asks for "1 year verkada camera license", but only 5-year exists.

**Old behavior:**
```
❌ Could not add "1 year verkada camera license"
```

**New behavior:**
```
❌ Could not add "1-year verkada camera license"
Reason: No products in your price book contain "1-year" for this item.

Closest matches (without "1-year"):
  • Verkada 5-Year Camera License, Capacity Increase
  • Verkada 10-Year Camera License, Capacity Increase
  • Verkada Camera License Pack

These products were NOT added because they don't have the required duration.
```

### Scenario 2: Low Keyword Score

**Example:** User asks for a product that doesn't exist, but similar ones do.

**Old behavior:**
```
❌ Could not add "environmental sensors"
```

**New behavior:**
```
❌ Could not add "environmental sensors"
Reason: No products scored high enough (need ≥ 50). Closest matches:
  • Environmental Monitoring System (score: 45)
  • Multi-Sensor Device (score: 38)
  • Temperature Sensor Kit (score: 32)

Searched for keywords: environmental, sensors
```

### Implementation

```typescript
if (request.duration) {
  // Duration constraint not met - show close matches WITHOUT the duration requirement
  reason = `No products in your price book contain "${request.duration}" for this item.`;
  
  const top3WithoutDuration = results.slice(0, 3);
  if (top3WithoutDuration.length > 0) {
    reason += `\n\nClosest matches (without "${request.duration}"):\n`;
    top3WithoutDuration.forEach((r, idx) => {
      reason += `  • ${idx + 1}. ${r.product.product_name}\n`;
    });
    reason += '\nThese products were NOT added because they don\'t have the required duration.';
  }
} else {
  // General keyword mismatch - show top 3 by keyword score
  if (results.length > 0) {
    const top3 = results.slice(0, 3);
    reason = `No products scored high enough (need ≥ ${MATCH_CONFIDENCE_THRESHOLD}). Closest matches:\n`;
    top3.forEach((r, idx) => {
      reason += `  • ${idx + 1}. ${r.product.product_name} (score: ${Math.round(r.score)})\n`;
    });
  }
}
```

**Key principles:**
- ✅ Show alternatives to help the user understand what's available
- ❌ NEVER auto-add products that don't meet hard constraints
- 📋 Make it clear these are NOT added to the project

---

## 🧪 Test Case: "Give me (5) 1 year verkada camera license"

### Expected Console Output

```
🧠 Phase 1: Extracting structured items from user message...
   User message: "Give me (5) 1 year verkada camera license"
✅ Extracted items: 5x verkada camera license (1-year)
📋 DEBUG: Full extracted items: [
  {
    "rawText": "(5) 1 year verkada camera license",
    "item": "verkada camera license",
    "brand": "Verkada",
    "productType": "license",
    "duration": "1-year",
    "quantity": 5,
    "action": "add"
  }
]

🔍 Matching item: verkada camera license (1-year)
   Keywords: Verkada 1-year license
   Duration constraint: 1-year

   📊 Top 5 candidates BEFORE hard constraints:
      1. "Verkada 5-Year Camera License, Capacity Increase" (score: 85)
         SearchText: verkada 5 year camera license capacity increase ...
      2. "Verkada 1-Year Camera License" (score: 82)
         SearchText: verkada 1 year camera license ...
      3. "Verkada 10-Year Camera License, Capacity Increase" (score: 78)
         SearchText: verkada 10 year camera license ...

   🔒 Applying duration constraint: [1-year, 1 year, 1year, 1 yr, 1-yr]
      ❌ "Verkada 5-Year Camera License, Capacity Increase" failed hard constraints
   
   ✓ Product: "Verkada 1-Year Camera License"
      Duration required: 1-year
      Variants checked: [1-year, 1 year, 1year, 1 yr, 1-yr]
      SearchText: "verkada 1 year camera license ..."
      Result: PASS

   ✅ Result: 5 keyword matches → 1 after hard constraints
   ✅ Matched: "Verkada 1-Year Camera License" (score: 82)
```

### Diagnosis Checklist

Using this output, we can answer:

1. ✅ **Did the LLM extract `duration: "1-year"`?**
   - Check the "Full extracted items" JSON

2. ✅ **Is the 1-year product in the keyword search results?**
   - Check the "Top 5 candidates BEFORE hard constraints"

3. ✅ **Does the 1-year product's searchText contain "1 year"?**
   - Check the SearchText line for candidate #2

4. ✅ **Is the hard constraint properly rejecting the 5-year product?**
   - Look for "❌ Verkada 5-Year... failed hard constraints"

5. ✅ **Is the 1-year product passing the hard constraint?**
   - Look for "✓ Product: Verkada 1-Year... Result: PASS"

---

## 🛠️ Improved Extraction Prompt

Added explicit example for the failing scenario:

```typescript
**EXAMPLES:**

Example 1:
Input: "Give me (5) 1 year verkada camera license"
Output:
[
  {
    "rawText": "(5) 1 year verkada camera license",
    "item": "verkada camera license",
    "brand": "Verkada",
    "productType": "license",
    "duration": "1-year",
    "quantity": 5,
    "action": "add"
  }
]

**CRITICAL RULES FOR DURATION:**
- "1 year", "1-year", "one year", "1 yr" → ALWAYS extract as duration: "1-year"
- "5 year", "5-year", "five year", "5 yr" → ALWAYS extract as duration: "5-year"
- "10 year", "10-year", "ten year", "10 yr" → ALWAYS extract as duration: "10-year"
- Do NOT drop duration when parsing quantities like "(5) 1 year"
- Duration is MANDATORY for license/subscription products
```

---

## ✅ Summary of Changes

| Component | Change | Purpose |
|-----------|--------|---------|
| **Phase 1 Logging** | Added full JSON dump of `extractedItems` | Verify LLM extraction accuracy |
| **Matching Logging** | Show top 5 candidates with their `searchText` | Diagnose why products are/aren't matching |
| **Duration Logging** | Show all normalized variants being checked | Confirm normalization is working |
| **Hard Constraint Logging** | Detailed PASS/FAIL for each product | Pinpoint exactly where filtering occurs |
| **Top 3 Close Matches** | Show alternatives when no exact match | Help users understand what's available without auto-substituting |
| **Extraction Prompt** | Added specific "(5) 1 year" example | Prevent LLM from dropping duration with quantities |
| **Duration Rules** | Explicit normalization rules in prompt | Ensure consistent "1-year" format |

---

## 🎯 Expected Outcome

With these changes, when a user says:
> "Give me (5) 1 year verkada camera license"

**If a 1-year product exists:**
- ✅ It will be matched and added (5 qty)
- 📋 Console logs will show it passing hard constraints

**If only a 5-year product exists:**
- ❌ The 5-year product will NOT be auto-added
- 📋 It will appear in "Couldn't Add" with top 3 close matches shown
- 💡 User will see: "Closest match: Verkada 5-Year... (without '1-year')"

**This prevents silent substitution while maintaining helpfulness.**

