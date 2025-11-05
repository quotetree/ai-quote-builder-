# Selectable Products Implementation

## Overview
Products in the "Suggested Products" tab are now selectable, allowing users to choose which products to add to the quote preview.

## Features Implemented

### 1. **Selectable Product Boxes**
- Click product box to select/deselect
- **Selected state:** Blue border (`border-blue-500`) + blue background (`bg-blue-50`)
- **Unselected state:** Gray border with hover effect
- Visual feedback on click

### 2. **Select All Checkbox**
- Located at top right, next to "Products to Add" heading
- Click to select/deselect all products at once
- Auto-updates based on product selections

### 3. **Smart Apply Button**
- **Disabled** when no products selected
- **Shows count:** "Apply 3 Products to Quote"
- **Single product:** "Apply 1 Product to Quote"
- **Nothing selected:** "Select Products to Apply"

### 4. **Apply Logic**
- Only selected products are added to preview
- Products **append** to existing preview items (doesn't replace)
- Selected products **removed** from "Suggested Products" list
- Unselected products **remain** in list for later use

### 5. **New Chat Behavior**
- When AI sends new products → **REPLACE** entire "Suggested Products" list
- Clears any leftover unselected products from previous conversation
- Fresh start for new recommendations

## User Workflow

### Scenario 1: Select & Apply Some Products
```
1. AI suggests 5 products
2. User clicks on 3 products (they turn blue)
3. Button shows: "Apply 3 Products to Quote"
4. User clicks button
5. Those 3 products move to Preview tab
6. Remaining 2 products stay in Suggested Products
```

### Scenario 2: Apply More Products Later
```
1. User chats: "Actually, add those 2 remaining products"
2. User selects the 2 products
3. Button shows: "Apply 2 Products to Quote"
4. User clicks button
5. Those 2 products are ADDED to existing 3 in preview (total: 5)
6. Suggested Products now empty
```

### Scenario 3: New Chat Replaces List
```
1. User has 2 unselected products remaining
2. User sends new message: "I need cameras instead"
3. AI responds with 3 camera products
4. Previous 2 products are REPLACED
5. Suggested Products shows only the 3 new camera products
```

## Technical Implementation

### Selection State
```typescript
interface ProductSuggestion {
  product_name: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  selected?: boolean;  // New: track selection
  id?: string;         // New: unique identifier
}
```

### Toggle Selection
```typescript
function toggleProductSelection(productId: string) {
  setSuggestedProducts(prev =>
    prev.map(p => p.id === productId ? { ...p, selected: !p.selected } : p)
  );
}
```

### Select All
```typescript
function toggleSelectAll() {
  const newSelectAll = !selectAll;
  setSelectAll(newSelectAll);
  setSuggestedProducts(prev =>
    prev.map(p => ({ ...p, selected: newSelectAll }))
  );
}
```

### Apply Selected Products
```typescript
async function applyChangesToQuote() {
  const selectedProducts = suggestedProducts.filter(p => p.selected);
  
  // Get existing preview items or start fresh
  const existingItems = quotePreview?.line_items || [];
  
  // Add selected products to existing items (append)
  const allItems = [...existingItems, ...selectedProducts];
  
  // Calculate new totals
  const subtotal = allItems.reduce((sum, item) => sum + item.line_total, 0);
  
  // Update preview
  setQuotePreview({ line_items: allItems, subtotal, ... });
  
  // Remove selected products from suggested list
  setSuggestedProducts(prev => prev.filter(p => !p.selected));
  
  // Switch to preview tab
  setActiveTab("preview");
}
```

### Replace on New Chat
```typescript
// When AI sends new products
if (products.length > 0) {
  // Add unique IDs and default selected state
  const productsWithIds = products.map((p, idx) => ({
    ...p,
    id: `${Date.now()}-${idx}`,
    selected: false
  }));
  
  // REPLACE (not append) the list
  setSuggestedProducts(productsWithIds);
  setSelectAll(false);
}
```

## UI Components

### Product Box (Unselected)
```jsx
<div className="p-4 rounded-lg border-2 border-gray-200 bg-white hover:border-gray-300 cursor-pointer">
  {/* Product details */}
</div>
```

### Product Box (Selected)
```jsx
<div className="p-4 rounded-lg border-2 border-blue-500 bg-blue-50 cursor-pointer">
  {/* Product details */}
</div>
```

### Select All Checkbox
```jsx
<label className="flex items-center gap-2 cursor-pointer">
  <input
    type="checkbox"
    checked={selectAll}
    onChange={toggleSelectAll}
    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
  />
  <span className="text-sm text-gray-700">Select All</span>
</label>
```

### Dynamic Button
```jsx
<button
  disabled={selectedCount === 0}
  className="w-full py-3 bg-gray-900 text-white rounded-lg disabled:opacity-50"
>
  {selectedCount > 0 
    ? `Apply ${selectedCount} Product${selectedCount > 1 ? 's' : ''} to Quote`
    : "Select Products to Apply"}
</button>
```

## Benefits

✅ **Flexible Selection:** Choose exactly which products to add
✅ **Visual Feedback:** Clear blue highlight shows what's selected
✅ **Smart Button:** Shows count and prevents empty applies
✅ **Incremental Building:** Add products in multiple batches
✅ **Clean Workflow:** New chat = fresh product list
✅ **Select All:** Quick way to select everything at once
✅ **Preview Accumulation:** Products accumulate in preview across multiple applies

## Example Flow

### Initial Quote:
1. User: "I need cameras and cables"
2. AI suggests 5 products
3. User selects 3 camera products
4. Clicks "Apply 3 Products to Quote"
5. Preview shows 3 products
6. 2 cable products remain in Suggested Products

### Adding More:
7. User reviews the 2 cables, selects 1
8. Clicks "Apply 1 Product to Quote"
9. Preview now shows 4 products total (3 cameras + 1 cable)
10. 1 cable remains unselected

### New Conversation:
11. User: "Actually, I need a lift instead"
12. AI suggests 2 lift products
13. Previous 1 cable is cleared
14. Suggested Products shows only 2 lift products

## Files Modified
- `/components/SplitChatPanel.tsx` - Added selection state, UI, and logic

## Testing Checklist
- [x] Click product to select (blue border appears)
- [x] Click again to deselect
- [x] Select All checkbox selects all products
- [x] Button disabled when nothing selected
- [x] Button shows correct count
- [x] Selected products move to preview
- [x] Unselected products remain in list
- [x] New chat replaces product list
- [x] Multiple applies accumulate in preview

