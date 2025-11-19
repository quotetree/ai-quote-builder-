# Generic Product Matching Refactor

**Branch:** `feature/chat-product-validation-and-summary`  
**Commit:** `8448b84`  
**Date:** November 19, 2025

## 📋 Overview

This refactor transforms the product matching system from **hard-coded, EPW-specific keywords** to a **generic, data-driven approach** that works for ANY industry based entirely on the 8 product fields users fill out in their price book.

---

## 🎯 Problem Statement

The previous system used hard-coded keywords like:
- `bullet`, `dome`, `turret`, `multisensor` (camera types)
- `solar`, `gridless` (power types)
- `cat5`, `cat6` (cable types)

**This had major problems:**
1. ❌ **EPW-specific** - Only worked for security camera businesses
2. ❌ **Not scalable** - Every new product type required code changes
3. ❌ **Maintenance burden** - Keyword lists had to be manually updated
4. ❌ **Limited to one industry** - Couldn't support landscapers, roofers, plumbers, etc.

---

## ✅ Solution: Field-Based Keyword Matching

The new system matches products based on **keywords in the user's request matching keywords in the 8 product fields**:

### 8 Product Fields (from UI)

1. **Product Name*** (required)
2. **Product Code** (optional)
3. **Product Brand** (optional)
4. **Product Type** (optional)
5. **Product Family** (optional)
6. **Description** (optional)
7. **List Price*** (required, not used for matching)
8. **Sales Price*** (required, not used for matching)

### How It Works

**Step 1: Build Searchable Text for Each Product**

```typescript
function buildSearchText(product: any): string {
  return [
    product.product_name,
    product.product_number,    // Product Code
    product.product_brand,
    product.product_type,
    product.product_family_name,
    product.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

**Example:**
- Product Name: "Premium TPO Membrane Roll"
- Product Brand: "Acme"
- Product Type: "Roofing"
- Description: "White 60mil TPO for commercial applications"

**Searchable Text:** `"premium tpo membrane roll acme roofing white 60mil tpo for commercial applications"`

**Step 2: Extract Keywords from User's Request**

```typescript
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(' ')
    .filter(word => word.length > 1 && !STOPWORDS.has(word));
}
```

**Example:**
- User request: "I need 5 Acme TPO membrane rolls"
- Extracted keywords: `["need", "5", "acme", "tpo", "membrane", "rolls"]`
- After stopword filter: `["acme", "tpo", "membrane", "rolls"]`

**Step 3: Score Each Product Against Keywords**

```typescript
searchKeywords.forEach(keyword => {
  if (searchText.includes(keyword)) {
    keywordsMatched++;
    score += 10;
  }
  
  if (productName.includes(keyword)) {
    score += 25; // Name match bonus
  }
  
  if (productBrand.includes(keyword)) {
    score += 30; // Brand match bonus
  }
  
  if (productType.includes(keyword)) {
    score += 20; // Type match bonus
  }
  
  if (productCode === keyword) {
    score += 200; // Exact code match (very strong)
  }
});

// All keywords matched bonus
if (keywordsMatched === searchKeywords.length) {
  score += 100;
}

// Missing keywords penalty
const missingKeywords = searchKeywords.length - keywordsMatched;
if (missingKeywords > 0) {
  score -= missingKeywords * 50;
}
```

**Step 4: Return Only Positive Scores**

```typescript
const results = sorted.filter(item => item.score > 0).slice(0, 20);

if (results.length === 0) {
  return []; // No matches → will trigger "not found" message
}
```

---

## 📊 Scoring Examples

### Example 1: Perfect Match

**User Request:** "5 Acme TPO membrane rolls"  
**Keywords:** `["acme", "tpo", "membrane", "rolls"]`

**Product:**
- Name: "Premium TPO Membrane Roll"
- Brand: "Acme"
- Type: "Roofing"

**Score Calculation:**
- "acme" in brand: +30 (brand) +10 (searchText) = +40
- "tpo" in name: +25 (name) +10 (searchText) = +35
- "membrane" in name: +25 (name) +10 (searchText) = +35
- "rolls" → "roll" in name: +25 (name) +10 (searchText) = +35
- All 4 keywords matched: +100
- **Total Score: 245** ✅ Strong match!

### Example 2: Partial Match (Missing Keywords)

**User Request:** "Verkada bullet cameras"  
**Keywords:** `["verkada", "bullet", "cameras"]`

**Product:**
- Name: "CH53-E Outdoor Four-Camera Multisensor"
- Brand: "Verkada"
- Type: "Camera"

**Score Calculation:**
- "verkada" in brand: +30 (brand) +10 (searchText) = +40
- "bullet" NOT found: -50 (missing keyword penalty)
- "cameras" → "camera" in type: +20 (type) +10 (searchText) = +30
- Only 2/3 keywords matched: -50 (missing keyword penalty)
- **Total Score: -30** ❌ Rejected (negative score)

### Example 3: Zero Match

**User Request:** "solar gridless unit"  
**Keywords:** `["solar", "gridless", "unit"]`

**Product:**
- Name: "Outdoor Dome Camera"
- Brand: "Verkada"
- Type: "Camera"

**Score Calculation:**
- "solar" NOT found: -50 (missing keyword penalty)
- "gridless" NOT found: -50 (missing keyword penalty)
- "unit" NOT found: -50 (missing keyword penalty)
- 0/3 keywords matched
- **Total Score: -150** ❌ Rejected (negative score)

---

## 🔄 What Changed

### 1. Removed Hard-Coded Logic

**Before:**
```typescript
const STRICT_KEYWORDS = ['bullet', 'dome', 'turret', 'multisensor', 'solar', 'gridless'];
const STRICT_KEYWORD_SYNONYMS: Record<string, string[]> = {
  bullet: ['bullet'],
  dome: ['dome'],
  // ... EPW-specific mappings
};

// Later in code...
const strictTerms = searchTerms.filter(t => STRICT_KEYWORDS.includes(t));
if (strictMatches.length === 0) {
  return []; // Force empty
}
```

**After:**
```typescript
// No hard-coded keywords! Everything is data-driven.
const searchKeywords = extractKeywords(keywords);
const results = sorted.filter(item => item.score > 0);
```

### 2. Added Generic Helper Functions

**New Functions:**
- `buildSearchText(product)` - Concatenates all text fields
- `extractKeywords(text)` - Removes stopwords, extracts meaningful terms

### 3. Simplified Scoring Logic

**Before:** Complex EPW-specific brand/type logic with hard-coded brands like `['verkada', 'rhombus', 'hikvision']`

**After:** Generic keyword matching across all fields with clear scoring weights

### 4. Updated System Prompt

**Before:**
```
**STRICT RULES:**
1. If user asks for "bullet camera" and search returns NO results → Report "not found"
2. NEVER suggest dome when user asked for bullet
3. NEVER suggest multisensor when user asked for dome
```

**After:**
```
**STRICT RULES:**
1. Products are matched by searching across: Product Name, Code, Brand, Type, Family, Description
2. If user asks for specific keywords and search returns NO results → Report "not found"
3. NEVER suggest products that don't match the user's keywords
```

### 5. Industry-Agnostic Examples

**Before:**
- "4 Verkada bullet cameras"
- "Hikvision dome cameras"
- "Verkada 5-year intercom license"

**After:**
- "5 Acme TPO membrane rolls" (roofing)
- "10 bags of mulch" (landscaping)
- "Premium widget from Acme" (generic)

---

## 🧪 Testing Examples

### Test Case 1: Landscaping Business

**Price Book:**
- Name: "Premium Hardwood Mulch Bag"
- Brand: "GreenScape"
- Type: "Mulch"
- Description: "2 cubic feet, dark brown hardwood"

**User Request:** "10 bags of mulch"  
**Keywords:** `["bags", "mulch"]`  
**Expected:** ✅ Match (both keywords found in name)

**User Request:** "5 pine bark nuggets"  
**Keywords:** `["pine", "bark", "nuggets"]`  
**Expected:** ❌ No match (keywords not in price book)

### Test Case 2: Roofing Business

**Price Book:**
- Name: "TPO Membrane Roll"
- Brand: "GAF"
- Type: "Roofing Material"
- Description: "White 60mil TPO, 10ft x 100ft"

**User Request:** "I need TPO roofing membrane"  
**Keywords:** `["tpo", "roofing", "membrane"]`  
**Expected:** ✅ Match (all keywords found)

**User Request:** "EPDM rubber roofing"  
**Keywords:** `["epdm", "rubber", "roofing"]`  
**Expected:** ❌ No match if no EPDM products exist

### Test Case 3: Security Business (Same as Before)

**Price Book:**
- Name: "CD53-E Outdoor Dome Camera"
- Brand: "Verkada"
- Type: "Camera"
- Description: "256GB, 30 Days Max"

**User Request:** "4 verkada bullet cameras"  
**Keywords:** `["verkada", "bullet", "cameras"]`  
**Expected:** ❌ No match ("bullet" not found)

**User Request:** "6 verkada dome cameras"  
**Keywords:** `["verkada", "dome", "cameras"]`  
**Expected:** ✅ Match (all keywords found)

---

## 📈 Benefits

### 1. **Industry-Agnostic**
Works for ANY business:
- Landscaping (mulch, plants, sprinklers)
- Roofing (TPO, EPDM, shingles)
- Plumbing (pipes, fittings, fixtures)
- Security (cameras, access control, sensors)
- HVAC (compressors, thermostats, ductwork)

### 2. **Zero Maintenance**
- No keyword lists to update
- No hard-coded product types
- Works automatically with any price book

### 3. **Transparent Matching**
- Users can see exactly which keywords matched
- Clear unfulfilled request messages show which keywords weren't found
- Example: "No products in your price book contain these keywords: solar, gridless"

### 4. **Scalable**
- Add 1,000 new products → system automatically searches them
- Works across all 6 text fields simultaneously
- Product code exact matches get highest priority

### 5. **Smart Matching**
- Handles plurals/variations (camera → cameras)
- Word order doesn't matter ("TPO membrane" = "membrane TPO")
- Compound phrase bonuses ("cat6 cable" as a phrase gets extra points)

---

## 🚀 Deployment

### Database Changes
**None required!** This refactor uses existing product fields.

### Migration Steps
1. Merge branch to main
2. Deploy to production
3. No database migrations needed
4. Works immediately with existing price books

### Backward Compatibility
✅ **Fully backward compatible**
- Existing price books work without changes
- Existing products are automatically searchable
- No user action required

---

## 📝 Technical Details

### Stopwords List
Common words filtered out of user requests:
```typescript
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'in', 'is', 'it', 'of', 'on', 'that', 'the', 'to', 'was', 'will',
  'with', 'i', 'need', 'want', 'also', 'some', 'get', 'can', 'my'
]);
```

### Score Threshold
```typescript
const MATCH_CONFIDENCE_THRESHOLD = 50;
```
Products scoring below 50 are treated as "not found".

### Field Weights
- Exact product code match: **+200 points** (highest)
- All keywords in name: **+150 bonus**
- All keywords found: **+100 bonus**
- Compound phrase match: **+40 per phrase**
- Brand match: **+30 per keyword**
- Name match: **+25 per keyword**
- Type match: **+20 per keyword**
- Generic searchText match: **+10 per keyword**
- Missing keyword penalty: **-50 per keyword**

---

## 🎓 Examples for Other Industries

### Landscaping: Sprinkler Installation

**User:** "I need 20 Rainbird sprinkler heads, 500 feet of poly pipe, and 10 control valves"

**Price Book:**
1. "Rainbird 1800 Series Spray Head" (Brand: Rainbird, Type: Sprinkler)
2. "Poly Irrigation Pipe 3/4in" (Type: Pipe)
3. "Anti-Siphon Control Valve" (Type: Valve)

**Matching:**
- "rainbird sprinkler heads" → Product 1 ✅
- "poly pipe" → Product 2 ✅
- "control valves" → Product 3 ✅

### Roofing: Commercial TPO Roof

**User:** "Quote for 5000 sq ft of TPO membrane, TPO adhesive, and edge metal"

**Price Book:**
1. "GAF EverGuard TPO Membrane 60mil" (Brand: GAF, Type: Roofing)
2. "TPO Bonding Adhesive 5gal" (Type: Adhesive)
3. "Galvanized Edge Metal 10ft" (Type: Flashing)

**Matching:**
- "tpo membrane" → Product 1 ✅
- "tpo adhesive" → Product 2 ✅
- "edge metal" → Product 3 ✅

### Plumbing: Bathroom Renovation

**User:** "Need a Kohler toilet, Moen faucet, and PEX piping"

**Price Book:**
1. "Kohler Highline Comfort Height Toilet" (Brand: Kohler, Type: Fixture)
2. "Moen Arbor Kitchen Faucet" (Brand: Moen, Type: Faucet)
3. "PEX Tubing 1/2in x 100ft" (Type: Pipe)

**Matching:**
- "kohler toilet" → Product 1 ✅
- "moen faucet" → Product 2 ✅
- "pex piping" → Product 3 ✅

---

## ✅ Acceptance Criteria

- [x] No hard-coded product type keywords in code
- [x] Matching works based on 6 product text fields
- [x] Stopword filtering implemented
- [x] Generic keyword extraction
- [x] Score-based matching with clear thresholds
- [x] Unfulfilled requests show which keywords weren't found
- [x] System prompt is industry-agnostic
- [x] Examples span multiple industries
- [x] No EPW-specific logic remains
- [x] Works for landscaping, roofing, plumbing, security, etc.

---

## 📖 Summary

This refactor transforms the product matching system from:
- ❌ Hard-coded, EPW-specific → ✅ Generic, data-driven
- ❌ Manual keyword maintenance → ✅ Zero maintenance
- ❌ One industry → ✅ ANY industry
- ❌ Opaque substitutions → ✅ Transparent keyword matching

**The system now works like a search engine**: user types keywords, system finds products where those keywords appear in any of the 6 text fields, and returns matches scored by relevance.

**No hard-coded product types. No industry-specific logic. Just pure keyword matching across your price book data.**

