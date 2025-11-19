# Frontend: "+ Add to Quote" Button Implementation

**Date:** November 19, 2025  
**Purpose:** Guide for implementing the "+ Add to Quote" button for low-confidence product matches  
**Status:** 🚧 Frontend implementation required

---

## 🎯 Overview

The backend now returns three distinct arrays with **guaranteed no overlap**:

```typescript
{
  suggestions: [],           // Score ≥ 50 (auto-added to quote)
  lowConfidenceMatches: [],  // Score 1-49 (show in chat, user can manually add)
  unfulfilled: []            // Score 0 (not found)
}
```

The frontend needs to:
1. Display these arrays separately
2. Provide a "+ Add to Quote" button for `lowConfidenceMatches`
3. Move items from "Possible Matches" to "Suggested Products" without page reload

---

## 🔧 Backend Guarantees

### 1. **No Duplicates Between Buckets**

The backend now **deduplicates by product ID** (lines 693-709):

```typescript
// Step 1: Filter high-confidence results
const highConfidenceResults = validResults.filter(r => r.score >= 50);

// Step 2: Build a Set of high-confidence product IDs
const highConfidenceIds = new Set(
  highConfidenceResults.map(r => r.product.id || r.product.product_name?.toLowerCase().trim())
);

// Step 3: Filter low-confidence, EXCLUDING anything already in high-confidence
const lowConfidenceResultsRaw = validResults.filter(r => r.score > 0 && r.score < 50);
const lowConfidenceResults = lowConfidenceResultsRaw.filter(r => {
  const productId = r.product.id || r.product.product_name?.toLowerCase().trim();
  return !highConfidenceIds.has(productId);  // ← Prevents overlap
});
```

**Result:** It's **impossible** for the same product to appear in both `suggestions` and `lowConfidenceMatches`.

### 2. **Response Structure**

Each product in the response has:

```typescript
interface ProductMatch {
  product_id: string;
  product_name: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  quantity_unit: string | null;
  price_unit: string | null;
  product_brand: string;
  product_type: string;
  match_confidence: number;  // The score (≥50 for suggestions, 1-49 for low-confidence)
  matched_requests: string[];
  requested_item?: string;  // What the user originally asked for (low-confidence only)
}
```

---

## 🎨 Frontend Implementation

### 1. **State Management**

```typescript
interface ChatMessage {
  // ... existing fields
  suggestions: ProductMatch[];
  lowConfidenceMatches: ProductMatch[];
  unfulfilled: UnfulfilledRequest[];
}

// Component state
const [suggestions, setSuggestions] = useState<ProductMatch[]>(
  response.suggestions || []
);

const [lowConfidenceMatches, setLowConfidenceMatches] = useState<ProductMatch[]>(
  response.lowConfidenceMatches || []
);
```

### 2. **"+ Add to Quote" Handler**

```typescript
function handleAddToQuote(match: ProductMatch) {
  // 1. Move selected item into suggestions
  setSuggestions(prev => {
    // Avoid duplicates (shouldn't happen, but be defensive)
    if (prev.some(p => p.product_id === match.product_id)) {
      console.warn('Product already in suggestions:', match.product_id);
      return prev;
    }
    return [...prev, match];
  });

  // 2. Remove it from low confidence list
  setLowConfidenceMatches(prev =>
    prev.filter(m => m.product_id !== match.product_id)
  );

  // 3. Optional: Show success toast
  toast.success(`Added ${match.product_name} to quote`);
}
```

### 3. **Render "Possible Matches"**

This should appear **in the chat message** (not in the Suggested Products panel):

```tsx
{lowConfidenceMatches.length > 0 && (
  <div className="possible-matches-section">
    <h4>💡 Possible Matches (Not Auto-Added)</h4>
    <p className="text-sm text-gray-600 mb-3">
      We didn't find a confident exact match, but here are some products you might mean:
    </p>
    
    {lowConfidenceMatches.map((match, idx) => (
      <div key={match.product_id} className="possible-match-item border rounded p-3 mb-2 flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <strong className="text-base">{idx + 1}. {match.product_name}</strong>
            {match.product_brand && (
              <span className="text-sm text-gray-500">({match.product_brand})</span>
            )}
          </div>
          
          <div className="text-sm text-gray-700 mt-1">
            ${match.unit_price.toFixed(2)} each
          </div>
          
          {match.requested_item && (
            <div className="text-xs text-gray-500 italic mt-1">
              For: "{match.requested_item}"
            </div>
          )}
          
          {/* Optional: Show confidence score for debugging */}
          {process.env.NODE_ENV === 'development' && (
            <div className="text-xs text-gray-400 mt-1">
              Score: {match.match_confidence}
            </div>
          )}
        </div>
        
        <button
          onClick={() => handleAddToQuote(match)}
          className="ml-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition whitespace-nowrap"
        >
          + Add to Quote
        </button>
      </div>
    ))}
    
    <p className="text-xs text-gray-500 mt-3 italic">
      *These items were not automatically added because the match confidence was low. 
      Please review and add manually if appropriate.*
    </p>
  </div>
)}
```

### 4. **Render "Suggested Products" Panel**

This is your existing panel, just make sure it uses the `suggestions` state:

```tsx
{suggestions.length > 0 && (
  <div className="suggested-products-panel">
    <h3>✅ Suggested Products</h3>
    
    {suggestions.map(item => (
      <div key={item.product_id} className="suggested-item">
        <strong>{item.product_name}</strong>
        <div className="text-sm text-gray-600">
          ${item.unit_price.toFixed(2)} each
        </div>
        
        {/* Quantity controls */}
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => decrementQuantity(item)}>-</button>
          <input
            type="number"
            value={item.quantity}
            onChange={(e) => updateQuantity(item, parseInt(e.target.value))}
            className="w-16 text-center"
          />
          <button onClick={() => incrementQuantity(item)}>+</button>
        </div>
        
        {/* Remove button */}
        <button onClick={() => removeFromQuote(item)}>
          Remove
        </button>
      </div>
    ))}
  </div>
)}
```

---

## 🔄 Mental Model

### Backend Flow

```
User message: "I need angle mounts"
    ↓
Phase 1: LLM extracts "angle mounts"
    ↓
Phase 2: Matcher searches price book
    ↓
Results:
  - Verkada Angle Mount, 30 deg (score: 5)
  - ACC-MNT-CORNER-1 (score: 4)
  - ACC-MNT-PEND-1 (score: 3)
    ↓
Three-tier system:
  - highConfidenceResults = [] (no score ≥ 50)
  - lowConfidenceResults = [3 products] (all scores 1-49)
  - Build Set of high IDs (empty)
  - Filter low-confidence to exclude high IDs (no change)
    ↓
Return:
  {
    suggestions: [],
    lowConfidenceMatches: [3 products],
    unfulfilled: []
  }
```

### Frontend Flow

```
Receive response:
  suggestions = []
  lowConfidenceMatches = [3 products]
    ↓
Render chat message:
  "💡 Possible Matches:"
  1. Verkada Angle Mount... [+ Add to Quote]
  2. ACC-MNT-CORNER-1...    [+ Add to Quote]
  3. ACC-MNT-PEND-1...      [+ Add to Quote]
    ↓
User clicks "+ Add to Quote" for #1:
  handleAddToQuote(product1)
    ↓
State updates:
  suggestions = [product1]
  lowConfidenceMatches = [product2, product3]
    ↓
Re-render (instant, no reload):
  - Suggested Products panel shows: product1
  - Possible Matches shows: product2, product3
```

---

## ✅ Checklist

### Backend (✅ Complete)
- [x] Dedupe by product ID to prevent overlap
- [x] Return `suggestions`, `lowConfidenceMatches`, `unfulfilled`
- [x] Format low-confidence section in chat response
- [x] Log score breakdown for debugging

### Frontend (🚧 To Implement)
- [ ] Add state management for `suggestions` and `lowConfidenceMatches`
- [ ] Implement `handleAddToQuote` function
- [ ] Render "Possible Matches" section in chat message
- [ ] Add "+ Add to Quote" button with click handler
- [ ] Ensure "Suggested Products" panel uses `suggestions` state
- [ ] Test: Click "+ Add to Quote" → product moves without reload
- [ ] Test: Same product can't appear in both sections

---

## 🧪 Testing Guide

### Test 1: Low-Confidence Products

**User message:**
```
I need angle mounts
```

**Expected:**
1. Chat message shows:
   ```
   💡 Possible Matches (Not Auto-Added):
   1. Verkada Angle Mount, 30 deg - $35.00 each
      [+ Add to Quote]
   2. ACC-MNT-CORNER-1 - $28.00 each
      [+ Add to Quote]
   ```

2. "Suggested Products" panel is empty

3. Click "+ Add to Quote" on item #1:
   - Item #1 moves to "Suggested Products" panel
   - Item #1 disappears from "Possible Matches"
   - Item #2 remains in "Possible Matches"
   - No page reload

---

### Test 2: High-Confidence Products

**User message:**
```
Add (5) Verkada CD53 outdoor dome cameras
```

**Expected:**
1. "Suggested Products" panel shows:
   ```
   ✅ Verkada CD53 Outdoor Dome Camera - $450.00 each (Qty: 5)
   ```

2. Chat message does NOT show "Possible Matches" section

---

### Test 3: Mixed Confidence

**User message:**
```
I need (3) outdoor cameras and angle mounts
```

**Expected:**
1. "Suggested Products" panel shows:
   ```
   ✅ Verkada CF83-E Outdoor Fisheye Camera - $420.00 each (Qty: 3)
   ✅ Verkada CD53-E Outdoor Dome Camera - $450.00 each (Qty: 3)
   ```

2. Chat message shows:
   ```
   💡 Possible Matches (Not Auto-Added):
   1. Verkada Angle Mount, 30 deg - $35.00 each
      [+ Add to Quote]
   2. ACC-MNT-CORNER-1 - $28.00 each
      [+ Add to Quote]
   ```

3. Click "+ Add to Quote" on angle mount:
   - Angle mount moves to "Suggested Products" panel
   - Angle mount disappears from "Possible Matches"
   - Outdoor cameras remain in "Suggested Products"

---

### Test 4: No Duplicates

**Server logs to verify:**
```
📊 Score breakdown: 2 high-confidence (≥50), 3 raw low-confidence, 3 deduped low-confidence (1-49)
```

If you see:
```
📊 Score breakdown: 2 high-confidence (≥50), 3 raw low-confidence, 0 deduped low-confidence (1-49)
```

This means all 3 low-confidence products were already in high-confidence (which shouldn't happen, but the deduplication is working).

---

## 📋 API Response Example

### Example Request
```
POST /api/chat
{
  "message": "I need angle mounts",
  "projectId": "..."
}
```

### Example Response
```json
{
  "message": "**Work Summary:**\n\nNo items were auto-added.\n\n**💡 Possible Matches (Not Auto-Added):**\n\nWe didn't find a confident exact match, but here are some products you might mean:\n\n1. **Verkada Angle Mount, 30 deg** (Verkada) - $35.00 each\n   *For: \"angle mounts\"*\n   → Use the **\"+ Add to Quote\"** button to add this item if it's correct.\n\n...",
  
  "suggestions": [],
  
  "lowConfidenceMatches": [
    {
      "product_id": "prod_abc123",
      "product_name": "Verkada Angle Mount, 30 deg",
      "description": "...",
      "quantity": 1,
      "unit_price": 35.00,
      "line_total": 35.00,
      "product_brand": "Verkada",
      "product_type": "Mounting Hardware",
      "match_confidence": 5,
      "matched_requests": ["angle mounts"],
      "requested_item": "angle mounts"
    },
    // ... more low-confidence matches
  ],
  
  "unfulfilled": []
}
```

---

## 🎯 Summary

| Component | Responsibility |
|-----------|----------------|
| **Backend** | Partition results, dedupe by ID, return clean arrays |
| **Frontend** | Render arrays, handle "+ Add to Quote" clicks, manage local state |
| **Button** | Move product from `lowConfidenceMatches` to `suggestions`, no reload |
| **UX** | Instant, smooth, no page refresh |

---

**With these changes, the "+ Add to Quote" button will work seamlessly, products will never appear in both buckets, and users get a modern search engine experience!** 🎉

