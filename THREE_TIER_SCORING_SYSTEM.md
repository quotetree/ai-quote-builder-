# Three-Tier Scoring System

**Date:** November 19, 2025  
**Status:** ✅ Implemented  
**Purpose:** Prevent auto-adding low-confidence matches while still showing them as suggestions

---

## 🎯 Overview

The system now uses a **three-tier scoring approach** to handle product matches, matching modern search UX patterns (Amazon, Salesforce, ServiceTitan, Home Depot):

### The Three Tiers

| Tier | Score Range | Behavior | Example |
|------|-------------|----------|---------|
| **1. High Confidence** | ≥ 50 | **Auto-add** to "Suggested Products" | "CD53 outdoor dome" → 90 score |
| **2. Low Confidence** | 1-49 | **Show as suggestions**, user manually adds | "angle mounts" → 5 score |
| **3. No Relevance** | 0 | **Don't show** at all | "alarm keypads" vs "Cat6 cable" |

---

## ✅ **Tier 1: High Confidence (Score ≥ 50) - AUTO-ADD**

### Behavior
- Automatically added to "Suggested Products"
- Appears in Work Summary
- User can adjust quantity or remove

### Example

**User message:**
```
Add (5) Verkada CD53 outdoor dome cameras
```

**Matching:**
- Verkada CD53 Outdoor Dome Camera (score: 90)

**Result:**
```
✅ Suggested Products:
  • Verkada CD53 Outdoor Dome Camera - $450.00 each (Qty: 5)
```

**Why auto-add?** Score ≥ 50 indicates strong keyword overlap and high confidence.

---

## 💡 **Tier 2: Low Confidence (Score 1-49) - SUGGEST ONLY**

### Behavior
- **NOT auto-added** to "Suggested Products"
- Shown in chat as "Possible Matches"
- User must manually click "**+ Add to Quote**" button
- Prevents low-confidence junk from cluttering the quote

### Example

**User message:**
```
I need angle mounts
```

**Matching:**
- Verkada Angle Mount, 30 deg (score: 5)
- ACC-MNT-CORNER-1 (score: 4)
- ACC-MNT-PEND-1 (score: 3)

**Result:**

```
💡 Possible Matches (Not Auto-Added):

We didn't find a confident exact match, but here are some products you might mean:

1. **Verkada Angle Mount, 30 deg** (Verkada) - $35.00 each
   *For: "angle mounts"*
   → Use the **"+ Add to Quote"** button to add this item if it's correct.

2. **ACC-MNT-CORNER-1** (Verkada) - $28.00 each
   *For: "angle mounts"*
   → Use the **"+ Add to Quote"** button to add this item if it's correct.

3. **ACC-MNT-PEND-1** (Verkada) - $32.00 each
   *For: "angle mounts"*
   → Use the **"+ Add to Quote"** button to add this item if it's correct.

*These items were not automatically added because the match confidence was low. Please review and add manually if appropriate.*
```

**Why not auto-add?** Score < 50 indicates weak keyword overlap. Keywords "angle" and "mounts" have minimal overlap with full product names.

---

## 🚫 **Tier 3: No Relevance (Score 0) - DON'T SHOW**

### Behavior
- Completely hidden from user
- Not in "Suggested Products"
- Not in "Possible Matches"
- Goes to "Couldn't Add (Not Found in Price Book)" if no better matches exist

### Example

**User message:**
```
I need alarm keypads
```

**Price book contains:**
- Cat6 Ethernet Cable (score: 0)
- POE Switch (score: 0)
- Junction Box (score: 0)

**Result:**
```
❌ Couldn't Add (Not Found in Price Book):
  × alarm keypads — No products in your price book contain these keywords: alarm, keypads
```

**Why not show?** Score 0 means literally no keyword overlap. Showing "Cat6 Cable" as a match for "alarm keypads" would be confusing and unhelpful.

---

## 🔧 Implementation Details

### Updated Return Type

```typescript
function matchEnhancedRequestsToPriceBook(
  requestedItems: EnhancedRequestedItem[], 
  products: any[]
): { 
  suggestions: any[];              // Score ≥ 50 (auto-add)
  lowConfidenceMatches: any[];     // Score 1-49 (suggest only)
  unfulfilled: UnfulfilledRequest[]; // Score 0 or constraints failed
}
```

### Matching Logic (Lines 688-791)

```typescript
// Separate high-confidence from low-confidence
const highConfidenceResults = validResults.filter(r => r.score >= MATCH_CONFIDENCE_THRESHOLD);
const lowConfidenceResults = validResults.filter(r => r.score > 0 && r.score < MATCH_CONFIDENCE_THRESHOLD);

console.log(`📊 Score breakdown: ${highConfidenceResults.length} high-confidence (≥50), ${lowConfidenceResults.length} low-confidence (1-49)`);

// Process high-confidence matches → add to suggestionsMap
const selectedMatches = selectExactMatchesForItem(highConfidenceResults);
selectedMatches.forEach(match => {
  // Add to suggestionsMap (auto-added to quote)
});

// Process low-confidence matches → add to lowConfidenceMap
const selectedLowConfidence = lowConfidenceResults.slice(0, MAX_PER_ITEM);
selectedLowConfidence.forEach(match => {
  // Add to lowConfidenceMap (suggested, not auto-added)
});

// If no matches at all (score 0), add to unfulfilled
if (selectedMatches.length === 0 && lowConfidenceResults.length === 0) {
  unfulfilled.push({ requestedText, reason });
}
```

### Response Formatting (Lines 1863-1900)

```typescript
// Build low-confidence suggestions section (scores 1-49)
let lowConfidenceSuggestionsText = '';
if (phase2LowConfidenceMatches.length > 0) {
  lowConfidenceSuggestionsText = '\n\n**💡 Possible Matches (Not Auto-Added):**\n\n';
  lowConfidenceSuggestionsText += 'We didn\'t find a confident exact match, but here are some products you might mean:\n\n';
  
  phase2LowConfidenceMatches.forEach((product, idx) => {
    lowConfidenceSuggestionsText += `${idx + 1}. **${product.product_name}**`;
    if (product.product_brand) {
      lowConfidenceSuggestionsText += ` (${product.product_brand})`;
    }
    lowConfidenceSuggestionsText += ` - $${product.unit_price} each\n`;
    lowConfidenceSuggestionsText += `   *For: "${product.requested_item}"*\n`;
    lowConfidenceSuggestionsText += `   → Use the **"+ Add to Quote"** button to add this item if it's correct.\n\n`;
  });
  
  lowConfidenceSuggestionsText += '*These items were not automatically added because the match confidence was low...*';
}

// Combine: Work Summary + Low-Confidence Suggestions + AI Response
const finalMessageParts = [workSummaryText.trim()];
if (lowConfidenceSuggestionsText) {
  finalMessageParts.push(lowConfidenceSuggestionsText.trim());
}
if (cleanedWithoutWorkSummary) {
  finalMessageParts.push(cleanedWithoutWorkSummary.trim());
}
cleanMessage = finalMessageParts.join('\n\n').trim();
```

---

## 📊 Server Logs

When you test, you'll see:

```
🔍 Matching item: angle mounts
   Keywords: angle mounts

📊 Top 5 candidates BEFORE hard constraints:
   1. "Verkada Angle Mount, 30 deg" (score: 5)
   2. "ACC-MNT-CORNER-1" (score: 4)
   3. "ACC-MNT-PEND-1" (score: 3)

✅ Result: 3 keyword matches → 3 after hard constraints
📊 Score breakdown: 0 high-confidence (≥50), 3 low-confidence (1-49)

💡 Showing 3 low-confidence match(es) as suggestions:
   1. "Verkada Angle Mount, 30 deg" (score: 5)
   2. "ACC-MNT-CORNER-1" (score: 4)
   3. "ACC-MNT-PEND-1" (score: 3)

🎯 Final results: 0 auto-added, 3 suggested, 0 unfulfilled
```

---

## 🎯 Why This System Works

### 1. **Matches Modern Search UX**
- **Amazon:** Shows "related products" when exact match isn't found
- **Salesforce:** Displays "suggested records" with manual selection
- **ServiceTitan:** Lists "possible matches" for partial searches
- **Home Depot:** Shows "you might also need" sections

### 2. **Prevents Low-Confidence Clutter**
**Before (auto-added everything):**
```
✅ Suggested Products:
  • Verkada Angle Mount, 30 deg - $35.00 (score: 5)  ❌ User didn't want this!
  • ACC-MNT-CORNER-1 - $28.00 (score: 4)             ❌ Wrong product!
```

**After (suggests low-confidence):**
```
💡 Possible Matches:
  1. Verkada Angle Mount, 30 deg - $35.00
     → Click "+ Add to Quote" if this is correct

✅ Suggested Products:
  (empty - nothing auto-added)
```

### 3. **Maintains Strictness + Flexibility**
- **Strict:** Don't auto-add low-confidence junk
- **Flexible:** Still show potentially relevant items
- **Helpful:** User can manually add if it's actually what they wanted

### 4. **Avoids "AI Missed Something" Feeling**
When "angle mounts" gets a score of 5:
- ✅ **Good UX:** "Here are some angle mount products you might mean..."
- ❌ **Bad UX:** "No products found" (when they DO exist)

---

## 🧪 Test Cases

### Test 1: High Confidence (Auto-Add)

**User:**
```
Add (5) Verkada CD53 outdoor dome cameras
```

**Expected:**
- ✅ "Verkada CD53 Outdoor Dome Camera" in "Suggested Products" (auto-added)
- ❌ Nothing in "Possible Matches"

---

### Test 2: Low Confidence (Suggest Only)

**User:**
```
I need angle mounts
```

**Expected:**
- ❌ "Suggested Products" is empty (nothing auto-added)
- ✅ "Possible Matches" shows:
  - Verkada Angle Mount, 30 deg
  - ACC-MNT-CORNER-1
  - ACC-MNT-PEND-1
- Each with "**+ Add to Quote**" instruction

---

### Test 3: No Relevance (Don't Show)

**User:**
```
I need alarm keypads
```

**Expected:**
- ❌ "Suggested Products" is empty
- ❌ "Possible Matches" is empty
- ✅ "Couldn't Add" shows:
  - "alarm keypads — No products in your price book contain these keywords: alarm, keypads"

---

### Test 4: Mixed Confidence

**User:**
```
I need (3) outdoor cameras and angle mounts
```

**Expected:**
- ✅ "Suggested Products" (auto-added, score ≥ 50):
  - Verkada CF83-E Outdoor Fisheye Camera (score: 80)
  - Verkada CD53-E Outdoor Dome Camera (score: 75)
- ✅ "Possible Matches" (suggest only, score 1-49):
  - Verkada Angle Mount, 30 deg (score: 5)
  - ACC-MNT-CORNER-1 (score: 4)

---

## ⚙️ Configuration

### MATCH_CONFIDENCE_THRESHOLD (Line 558)

```typescript
const MATCH_CONFIDENCE_THRESHOLD = 50;
```

**Tuning guide:**
- **Increase to 60-70:** More items go to "Possible Matches", fewer auto-added (stricter)
- **Decrease to 40:** More items auto-added, fewer in "Possible Matches" (more permissive)
- **Recommendation:** Keep at 50 (good balance)

---

## ✅ Summary

| Aspect | Implementation |
|--------|----------------|
| **High Confidence** | Score ≥ 50 → Auto-add to "Suggested Products" |
| **Low Confidence** | Score 1-49 → Show in "Possible Matches" with manual add |
| **No Relevance** | Score 0 → Don't show at all |
| **User Benefit** | Prevents clutter, maintains flexibility, matches modern search UX |
| **Examples** | "CD53 dome" (90) auto-adds, "angle mounts" (5) suggests only |

---

## 🔗 Related Documentation

- `HYBRID_SEARCH_ENGINE_MODEL.md` - Multiple results for ambiguous requests
- `DURATION_CONSTRAINT_FIXES.md` - Hard constraint enforcement
- `CRITICAL_FIX_PHASE2_IGNORED.md` - Why Phase 2 results are used

---

**This three-tier system provides the perfect balance of automation (high confidence) and manual control (low confidence), matching how users expect modern search to work!**

