# Hybrid Search Engine Model (Option B)

**Date:** November 19, 2025  
**Status:** ✅ Implemented  
**Applies:** From the FIRST message onwards (not just corrections)

---

## 🎯 Overview

The matching system now works like a **search engine** - returning **multiple products when ambiguous**, and **single products when precise**. This applies from the very first user message.

### Key Principle

**For each requested item:**
1. Run keyword search across price book
2. Apply hard constraints (duration, brand, etc.)
3. Decide: **Precise** (1 result) vs **Ambiguous** (N results)
4. Show results accordingly in "Suggested Products"

---

## 🔧 Configuration

### Constants (lines 568-582)

```typescript
/**
 * Maximum number of products to show per requested item when matches are ambiguous.
 */
const MAX_PER_ITEM = 4;

/**
 * Score difference threshold to determine if a match is "precise" vs "ambiguous".
 * 
 * If top match's score is >= CLEAR_WINNER_DELTA higher than second match,
 * we treat it as precise (return only that one product).
 * 
 * Otherwise, ambiguous (return up to MAX_PER_ITEM products).
 */
const CLEAR_WINNER_DELTA = 30;
```

**Tuning guide:**
- `MAX_PER_ITEM = 4`: Good balance for UI. Shows enough options without overwhelming.
- `CLEAR_WINNER_DELTA = 30`: 
  - Score 520 vs 480 (delta 40) → Precise, single result
  - Score 520 vs 510 (delta 10) → Ambiguous, show multiple

---

## 🧠 Decision Logic

### `selectExactMatchesForItem()` (lines 595-620)

```typescript
function selectExactMatchesForItem(exactMatches: any[]): any[] {
  if (exactMatches.length === 0) return [];
  
  // Case 1: Only one match → precise, return it
  if (exactMatches.length === 1) {
    console.log(`      → Precise: single match found`);
    return [exactMatches[0]];
  }
  
  // Case 2: Multiple matches - check score gap between top 2
  const [first, second] = exactMatches;
  const scoreDelta = first.score - second.score;
  
  // If the top result is clearly better → treat as precise, single result
  if (scoreDelta >= CLEAR_WINNER_DELTA) {
    console.log(`      → Precise: clear winner (score gap ${scoreDelta})`);
    return [first];
  }
  
  // Otherwise, ambiguous → return up to MAX_PER_ITEM matches
  const selected = exactMatches.slice(0, MAX_PER_ITEM);
  console.log(`      → Ambiguous: returning ${selected.length} matches`);
  return selected;
}
```

---

## 📊 Examples

### Example A: "misc material" (Ambiguous)

**User message:**
```
I need 300 misc material
```

**Price book contains:**
- Cat6 and conduit misc material (score: 520)
- Misc material (score: 520)
- Miscellaneous Material (score: 515)
- Travel Miscellaneous (score: 510)

**Analysis:**
- Top score: 520
- Second score: 520
- Delta: 0 (< 30)
- **Decision: AMBIGUOUS**

**Result:**
```
✅ Suggested Products (4 items):
  • Cat6 and conduit misc material - Qty: 300
  • Misc material - Qty: 300
  • Miscellaneous Material - Qty: 300
  • Travel Miscellaneous - Qty: 300
```

**User action:** Choose the correct SKU(s) from the list.

---

### Example B: "outdoor cameras" (Ambiguous)

**User message:**
```
I need (3) outdoor cameras
```

**Price book contains:**
- Verkada CF83-E Outdoor Fisheye Camera (score: 480)
- Verkada CH53-E Outdoor Four-Camera Multisensor (score: 475)
- Verkada CD53-E Outdoor Dome Camera (score: 470)

**Analysis:**
- Top score: 480
- Second score: 475
- Delta: 5 (< 30)
- **Decision: AMBIGUOUS**

**Result:**
```
✅ Suggested Products (3 items):
  • Verkada CF83-E Outdoor Fisheye Camera - Qty: 3
  • Verkada CH53-E Outdoor Four-Camera Multisensor - Qty: 3
  • Verkada CD53-E Outdoor Dome Camera - Qty: 3
```

**User action:** Choose which outdoor camera model(s) to add to quote.

---

### Example C: Exact SKU / Precise Match

**User message:**
```
Add (5) Verkada CD53-256GB indoor mini dome cameras
```

**Price book contains:**
- Verkada CD53 Indoor Mini Dome Camera, 256 GB (score: 650) ← Exact match
- Verkada CD53 Indoor Mini Dome Camera, 128 GB (score: 580)
- Verkada CD52 Indoor Mini Dome Camera (score: 520)

**Analysis:**
- Top score: 650
- Second score: 580
- Delta: 70 (>= 30)
- **Decision: PRECISE**

**Result:**
```
✅ Suggested Products (1 item):
  • Verkada CD53 Indoor Mini Dome Camera, 256 GB - Qty: 5
```

**Reasoning:** Keywords "CD53", "256GB", "indoor", "mini dome" all strongly match the first product. No ambiguity.

---

### Example D: Duration Constraint (Hard Constraint Still Applies)

**User message:**
```
Give me (5) 1 year verkada camera license
```

**Scenario 1: 1-year license exists**

**Price book contains:**
- Verkada 1-Year Camera License (score: 520) ← Passes duration constraint
- Verkada 5-Year Camera License (score: 520) ← FAILS duration constraint

**Analysis:**
- Hard constraint: `duration: "1-year"`
- After filtering: Only 1-year product remains
- **Decision: PRECISE** (only one valid product)

**Result:**
```
✅ Suggested Products (1 item):
  • Verkada 1-Year Camera License - Qty: 5
```

**Scenario 2: Only 5-year license exists**

**Price book contains:**
- Verkada 5-Year Camera License (score: 520) ← FAILS duration constraint
- Verkada 10-Year Camera License (score: 480) ← FAILS duration constraint

**Analysis:**
- Hard constraint: `duration: "1-year"`
- After filtering: 0 products remain
- **Decision: UNFULFILLED**

**Result:**
```
❌ Could not add "1-year verkada camera license"

Reason: No products in your price book contain "1-year" for this item.

Closest matches (without "1-year"):
  • Verkada 5-Year Camera License, Capacity Increase
  • Verkada 10-Year Camera License, Capacity Increase

These products were NOT added because they don't have the required duration.
```

**Key:** Duration is a **hard constraint**, never bypassed even if close matches exist.

---

## 🔄 Updated Matching Flow

### Previous Behavior (Before Option B)

```typescript
// Old logic: Always picked the single top match
const top = validResults[0];
if (top && top.score >= THRESHOLD) {
  addToSuggestions(top);  // Only 1 product added
}
```

**Problem:** 
- User says "misc material" → only got "Cat6 and conduit misc material"
- User says "outdoor cameras" → only got the first camera model
- No way to see alternatives without asking again

---

### New Behavior (Option B)

```typescript
// Filter by confidence threshold
const qualifiedResults = validResults.filter(r => r.score >= MATCH_CONFIDENCE_THRESHOLD);

// Use hybrid selection - returns 1 for precise, N for ambiguous
const selectedMatches = selectExactMatchesForItem(qualifiedResults);

if (selectedMatches.length > 0) {
  // Add ALL selected matches to suggestions
  selectedMatches.forEach((matchResult) => {
    addToSuggestions(matchResult);  // 1-4 products added per item
  });
}
```

**Benefits:**
- User says "misc material" → sees all misc-related SKUs
- User says "outdoor cameras" → sees all outdoor camera models
- User says exact SKU → only gets that specific product
- Works from the FIRST message (not just on follow-ups)

---

## 🎨 UX Impact

### Suggested Products Panel

**Before (Single match only):**
```
✅ Suggested Products:
  • Cat6 and conduit misc material - $45.00 each (Qty: 300)
```

**After (Hybrid - multiple when ambiguous):**
```
✅ Suggested Products:
  • Cat6 and conduit misc material - $45.00 each (Qty: 300)
  • Misc material - $32.00 each (Qty: 300)
  • Miscellaneous Material - $38.50 each (Qty: 300)
  • Travel Miscellaneous - $50.00 each (Qty: 300)
```

**User Experience:**
- User can see all relevant options immediately
- Choose which specific SKU(s) to apply to the quote
- No need for follow-up questions like "do you have other misc options?"
- Works like a modern search engine

---

## 📋 Behavior Matrix

| User Request | Match Type | Products Shown | Reason |
|--------------|------------|----------------|--------|
| "misc material" | Ambiguous | 4 SKUs | Multiple strong matches (scores 520, 520, 515, 510) |
| "outdoor cameras" | Ambiguous | 3 SKUs | Similar scores (480, 475, 470) |
| "Verkada CD53-256GB indoor mini dome" | Precise | 1 SKU | Clear winner (650 vs 580, delta 70) |
| "1 year verkada camera license" (exists) | Precise | 1 SKU | Only one passes hard constraint |
| "1 year verkada camera license" (doesn't exist) | Unfulfilled | 0 SKUs | Hard constraint not met, alternatives shown |

---

## 🧪 Test Cases

### Test 1: Ambiguous from First Message

**User (first message in new chat):**
```
I need misc material for 300
```

**Expected server logs:**
```
🔍 Matching item: misc material
   Keywords: misc material

📊 Top 5 candidates BEFORE hard constraints:
   1. "Cat6 and conduit misc material" (score: 520)
   2. "Misc material" (score: 520)
   3. "Miscellaneous Material" (score: 515)
   4. "Travel Miscellaneous" (score: 510)

✅ Result: 4 keyword matches → 4 after hard constraints
   → Score gap between top 2: 0 (threshold: 30)
   → Ambiguous: returning 4 matches (max 4)

✅ Adding 4 product(s) to suggestions:
   1. "Cat6 and conduit misc material" (score: 520)
   2. "Misc material" (score: 520)
   3. "Miscellaneous Material" (score: 515)
   4. "Travel Miscellaneous" (score: 510)
```

**Expected UI:**
- Suggested Products: All 4 misc-related SKUs with Qty: 300 each

---

### Test 2: Precise from First Message

**User (first message in new chat):**
```
Add (5) Verkada CD53-256GB indoor mini dome cameras
```

**Expected server logs:**
```
🔍 Matching item: verkada CD53-256GB indoor mini dome cameras
   Keywords: Verkada CD53 256GB indoor mini dome cameras

📊 Top 5 candidates BEFORE hard constraints:
   1. "Verkada CD53 Indoor Mini Dome Camera, 256 GB" (score: 650)
   2. "Verkada CD53 Indoor Mini Dome Camera, 128 GB" (score: 580)
   3. "Verkada CD52 Indoor Mini Dome Camera" (score: 520)

✅ Result: 3 keyword matches → 3 after hard constraints
   → Score gap between top 2: 70 (threshold: 30)
   → Precise: clear winner (score gap 70 >= 30)

✅ Adding 1 product(s) to suggestions:
   1. "Verkada CD53 Indoor Mini Dome Camera, 256 GB" (score: 650)
```

**Expected UI:**
- Suggested Products: Only the CD53-256GB product with Qty: 5

---

### Test 3: Duration Constraint (Hard Constraint)

**User (first message in new chat):**
```
Give me (5) 1 year verkada camera license
```

**Scenario A: 1-year exists**

**Expected server logs:**
```
🔍 Matching item: verkada camera license (1-year)
   Duration constraint: 1-year

📊 Top 5 candidates BEFORE hard constraints:
   1. "Verkada 5-Year Camera License" (score: 520)
   2. "Verkada 1-Year Camera License" (score: 520)

🔒 Applying duration constraint: [1-year, 1 year, 1year, 1 yr, 1-yr]
   ❌ "Verkada 5-Year Camera License" failed hard constraints

✅ Result: 2 keyword matches → 1 after hard constraints
   → Precise: single match found

✅ Adding 1 product(s) to suggestions:
   1. "Verkada 1-Year Camera License" (score: 520)
```

**Expected UI:**
- Suggested Products: Only 1-year license with Qty: 5
- ❌ 5-year license is NOT shown

**Scenario B: Only 5-year exists**

**Expected UI:**
```
❌ Could not add "1-year verkada camera license"

Reason: No products in your price book contain "1-year" for this item.

Closest matches (without "1-year"):
  • Verkada 5-Year Camera License
  • Verkada 10-Year Camera License

These products were NOT added because they don't have the required duration.
```

---

## ⚙️ Tuning Guidelines

### Adjusting MAX_PER_ITEM

**Current value: 4**

- **If UI feels cluttered:** Reduce to 3
- **If users want more options:** Increase to 5-6
- **Recommendation:** Keep at 4 (good balance)

### Adjusting CLEAR_WINNER_DELTA

**Current value: 30**

- **Too many single results when should be multiple:** Increase to 40-50
- **Too many multi-results when should be single:** Decrease to 20-25
- **Recommendation:** Start at 30, tune based on user feedback

**Score deltas you'll typically see:**
- Exact code match vs similar: 100+ delta → Always precise
- Exact name vs partial: 50-70 delta → Precise with 30 threshold
- Similar products: 5-15 delta → Ambiguous with 30 threshold
- Identical scores: 0 delta → Always ambiguous

---

## ✅ Summary

| Aspect | Implementation |
|--------|----------------|
| **Applies when** | From the FIRST message onwards |
| **Ambiguous logic** | Score gap < 30 → show up to 4 products |
| **Precise logic** | Score gap >= 30 or only 1 match → show 1 product |
| **Hard constraints** | Always enforced (duration, brand, etc.) |
| **Close matches** | Shown in "Couldn't Add" when no exact match, never auto-added |
| **User benefit** | Search engine UX - see all relevant options immediately |

---

## 🔗 Related Documentation

- `TWO_PHASE_AI_PIPELINE.md` - Overall architecture
- `DURATION_CONSTRAINT_FIXES.md` - Hard constraint enforcement
- `CRITICAL_FIX_PHASE2_IGNORED.md` - Why Phase 2 results are now used
- `DEBUG_EXTRACTION_AND_MATCHING.md` - Debugging and logging guide

---

**This makes the system work like a real search engine, giving users the right level of specificity from the very first message.**

