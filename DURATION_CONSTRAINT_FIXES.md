# Duration as Hard Constraint - Critical Bug Fixes

**Branch:** `feature/chat-product-validation-and-summary`  
**Commit:** `e6d42d5`  
**Date:** November 19, 2025

---

## 🐛 Bugs Fixed

### Bug 1: Duration Substitution
**Before:** User says "1 year license" → System adds 5-year license  
**After:** User says "1 year license" → System ONLY matches 1-year OR reports not found

### Bug 2: Corrections Ignored
**Before:** "Not the 5-year, use the 1-year" → Still returns 5-year  
**After:** "Not the 5-year, use the 1-year" → Removes 5-year, matches only 1-year

### Bug 3: Unrelated Products Leak
**Before:** Request license → Also get multisensor cameras from previous message  
**After:** Request license → Only get licenses from CURRENT message

---

## ✅ Solution Architecture

### 1. Enhanced LLM Extraction Prompt

```typescript
// NOW: Explicit duration normalization instructions
**CRITICAL INSTRUCTIONS FOR DURATION:**

Duration is a **STRICT, NON-SUBSTITUTABLE CONSTRAINT**

1. Normalize duration formats:
   - "1 year", "1-year", "one year" → "1-year"
   - "5 year", "5-year", "five year" → "5-year"
   
2. Duration in corrections:
   - "I need the **1 year** license, **not the 5 year**"
   → Extract: duration="1-year", action="replace", replaces="5-year license"
   - This is a CORRECTION, not two separate requests!

3. Multiple items with different durations:
   - "5 environmental sensors and (5) 1 year verkada camera license"
   → Extract TWO items (one with duration, one without)
```

### 2. Hard Constraint Enforcement

```typescript
function meetsHardConstraints(product: any, item: EnhancedRequestedItem): boolean {
  const searchText = buildSearchText(product);
  
  // CRITICAL: Duration is a hard constraint
  if (item.duration) {
    const durationVariants = normalizeDuration(item.duration);
    // ["1 year", "1-year", "1year", "1 yr", "1-yr"]
    
    const hasDuration = durationVariants.some(variant => 
      searchText.includes(variant)
    );
    
    if (!hasDuration) {
      // REJECT this product - wrong duration
      return false;
    }
  }
  
  return true;
}
```

**Key:** Even if a product scores high on keywords, if duration doesn't match, it's REJECTED.

### 3. Enhanced Matching Function

```typescript
function matchEnhancedRequestsToPriceBook(
  requestedItems: EnhancedRequestedItem[], 
  products: any[]
) {
  requestedItems.forEach(request => {
    const results = searchProductsWithScores(products, keywords);
    
    // CRITICAL: Filter by hard constraints
    const validResults = results.filter(result => 
      meetsHardConstraints(result.product, request)
    );
    
    // Only use validResults for matching
    const top = validResults[0];
    
    if (!top) {
      // No valid match → unfulfilled request
      unfulfilled.push({
        requestedText: `${request.duration} ${request.item}`,
        reason: `No products contain "${request.duration}" in their fields.`
      });
    }
  });
}
```

### 4. Improved Correction Handling

```typescript
function updateConversationState(extractedItems, currentState, message) {
  extractedItems.forEach(item => {
    if (item.action === 'replace') {
      // Remove old items with wrong duration
      accumulated = accumulated.filter(existing => {
        const sameType = existing.productType === item.productType;
        const differentDuration = existing.duration !== item.duration;
        
        if (sameType && differentDuration) {
          // Remove 5-year when user corrects to 1-year
          return false;
        }
        return true;
      });
      
      // Add corrected item
      accumulated.push(item);
    }
  });
}
```

### 5. Only Match Current Message Items

```typescript
// OLD (WRONG):
const { suggestions } = matchEnhancedRequestsToPriceBook(
  conversationState.accumulatedItems, // ❌ Includes old items!
  products
);

// NEW (CORRECT):
const { suggestions } = matchEnhancedRequestsToPriceBook(
  extractedItems, // ✅ Only current message!
  products
);
```

---

## 🧪 Test Case Verification

### Test Case 1: Mixed Items with Duration

**Input:**
```
"i need 5 environmental sensors and (5) 1 year verkada camera license"
```

**Phase 1 - Extraction:**
```json
[
  {
    "item": "environmental sensors",
    "quantity": 5,
    "action": "add"
    // NO duration field
  },
  {
    "item": "verkada camera license",
    "brand": "Verkada",
    "productType": "license",
    "duration": "1-year", // ⭐ EXTRACTED
    "quantity": 5,
    "action": "add"
  }
]
```

**Phase 2 - Matching:**
```
Item 1: "environmental sensors"
- Searches: "environmental sensors"
- No duration constraint
- If not in price book → unfulfilled ✅

Item 2: "verkada camera license" (duration: "1-year")
- Searches: "verkada 1-year license camera license"
- Finds products with keyword matches
- FILTERS by hard constraint:
  - Product A: "Verkada 1-Year License" → ✅ Contains "1 year"
  - Product B: "Verkada 5-Year License" → ❌ Rejected (no "1 year")
- Only returns Product A ✅
```

**Result:**
- ✅ Environmental sensors → Unfulfilled (if not in price book)
- ✅ 1-year license → Matched (ONLY 1-year products)
- ❌ NO 5-year license substitution

### Test Case 2: Duration Correction

**Message 1:**
```
"I need (5) 5 year verkada camera licenses"
```

**Phase 1:**
```json
[{
  "item": "verkada camera license",
  "duration": "5-year",
  "quantity": 5
}]
```

**ConversationState after Message 1:**
```json
{
  "accumulatedItems": [{
    "item": "verkada camera license",
    "duration": "5-year",
    "quantity": 5
  }]
}
```

**Message 2:**
```
"I need the 1 year verkada camera license not the 5"
```

**Phase 1 Extraction:**
```json
[{
  "item": "verkada camera license",
  "duration": "1-year",
  "quantity": 1,
  "action": "replace", // ⭐ CORRECTION DETECTED
  "replaces": "5-year license"
}]
```

**updateConversationState:**
```typescript
// Item has action="replace" and duration="1-year"
// Find existing items with productType="license" and duration="5-year"
// Remove them ✅
// Add new item with duration="1-year" ✅

Result: accumulatedItems = [{
  "item": "verkada camera license",
  "duration": "1-year", // ⭐ CORRECTED
  "quantity": 1
}]
```

**Phase 2 Matching (only extractedItems):**
```
Item: "verkada camera license" (duration: "1-year")
- Searches: "verkada 1-year license"
- Hard constraint: MUST contain "1 year" variants
- Filters products:
  - "Verkada 1-Year License" → ✅
  - "Verkada 5-Year License" → ❌ Rejected
```

**Result:**
- ✅ Only 1-year license in suggestions
- ❌ NO 5-year license in results

---

## 📊 How Duration Matching Works

### Duration Normalization

```typescript
normalizeDuration("1-year")
→ ["1-year", "1 year", "1year", "1 yr", "1-yr"]

Product: "Verkada 1-Year Camera License"
searchText: "verkada 1 year camera license ..."

Check: Does searchText include ANY variant?
- "1 year" ✅ FOUND
→ Hard constraint met!
```

### Rejection Example

```typescript
Request: duration="1-year"
Variants: ["1-year", "1 year", "1year", ...]

Product: "Verkada 5-Year Camera License"
searchText: "verkada 5 year camera license ..."

Check: Does searchText include ANY variant of "1-year"?
- "1 year" ❌ NOT FOUND
- "1-year" ❌ NOT FOUND
- ...
→ Hard constraint FAILED - Product REJECTED
```

---

## 🔍 Debugging Logs

The system now logs detailed information:

```bash
🧠 Phase 1: Extracting structured items from user message...
✅ Extracted items: ["5x environmental sensors (no duration)", "5x verkada camera license (1-year)"]

📝 Updated conversation state: {
  newItems: 2,
  totalAccumulated: 2
}

🔍 Phase 2: Matching against price book with strict hard constraints...
   Items to match (from CURRENT message only): 2
   1. 5x environmental sensors (action: add)
   2. 5x 1-year verkada camera license (action: add)

🔍 Matching item: environmental sensors
   Keywords: environmental sensors
   Found 0 keyword matches, 0 after hard constraints
   ❌ No valid match: No products in your price book contain these keywords

🔍 Matching item: verkada camera license (1-year)
   Keywords: verkada 1-year license camera license
   Found 2 keyword matches, 1 after hard constraints
❌ Hard constraint failed: Product "Verkada 5-Year License" does not contain duration "1-year"
   Searched for variants: 1-year, 1 year, 1year, 1 yr, 1-yr
   ✅ Matched: "Verkada 1-Year Camera License" (score: 250)

✅ Matching results: {
  suggestions: 1,
  unfulfilled: 1
}
```

---

## 🎯 Summary

### What Changed:

1. **LLM Extraction** - Enhanced prompt with explicit duration handling
2. **Hard Constraints** - Added `meetsHardConstraints()` to enforce duration
3. **Duration Normalization** - Flexible matching of "1 year", "1-year", etc.
4. **Improved Corrections** - `updateConversationState()` removes conflicting durations
5. **Isolated Matching** - Only match `extractedItems`, not `accumulatedItems`

### Key Principle:

**Duration is NON-SUBSTITUTABLE:**
- 1-year ≠ 5-year ≠ 10-year
- If user asks for 1-year → ONLY 1-year products are valid
- If no 1-year products exist → Unfulfilled request (NOT 5-year substitution)

### Result:

✅ Accurate duration matching  
✅ No unwanted substitutions  
✅ Clear unfulfilled messages  
✅ Proper correction handling  
✅ No unrelated product leakage  

**The system now respects user intent with zero tolerance for duration substitutions!** 🎯

