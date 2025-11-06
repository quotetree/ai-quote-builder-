# Preview Tab Editing & Chat Management Implementation

## Overview
Added interactive editing capabilities to the Preview tab in the split-screen chat interface, allowing users to manage products in their quote preview before final submission. Also includes chat clearing functionality to start over with a clean canvas.

## Features Implemented

### 1. **Drag & Drop Reordering** 🎯
- Intuitive drag-and-drop functionality to reorder line items
- Grip handle icon (⋮⋮) on the left side of each product
- Visual feedback during drag:
  - Dragged item becomes semi-transparent (50% opacity)
  - Drop target highlights with blue border and background
  - Cursor changes to `grab` on hover, `grabbing` while dragging
- Smooth animations and transitions
- Works by dragging any product to a new position

### 2. **Edit Quantity** ✏️
- Click the edit icon (appears on hover) next to quantity information
- Inline editing mode with:
  - Number input field (supports decimals with step=0.01)
  - Save button to confirm changes
  - Cancel button to discard changes
  - Enter key to save
  - Escape key to cancel
- Automatically recalculates:
  - Line total for the item
  - Quote subtotal
  - Tax amount
  - Final total
- Validation: Quantity must be at least 0.01
- Success toast notification on save

### 3. **Delete Products** 🗑️
- Delete icon appears on hover at the right side of each product
- Confirmation dialog before deletion: "Remove [Product Name] from quote?"
- Automatically recalculates all totals after deletion
- If last product is deleted, preview returns to empty state
- Success toast notification after deletion

### 4. **Clear Chat** 🔄
- "Clear Chat" button appears at the top of the chat panel when there are messages
- Allows starting over with a clean canvas
- Perfect for when:
  - Scope of work changes mid-conversation
  - You want to build a completely different quote
  - You need to reset and start fresh
- Confirmation dialog before clearing
- Clears all messages from database and state
- Resets suggested products and quote preview
- Shows fresh welcome message after clearing
- Shows message count (e.g., "5 messages") in header

## User Interface

### Visual Design
- **Hover Effects**: Edit and delete buttons appear on hover for cleaner interface
- **Group Styling**: Each product card has a subtle gray background with rounded corners
- **Color Coding**:
  - Drag handle: Gray (#9ca3af) → darker on hover (#4b5563)
  - Edit icon: Blue (#2563eb)
  - Delete icon: Red (#dc2626)
  - Drag state: Blue borders (#3b82f6 and #60a5fa)
- **Cursor States**: 
  - `cursor-move` on entire card
  - `cursor-grab` on drag handle
  - `cursor-grabbing` while actively dragging
- **Drag Feedback**:
  - Dragged item: 50% opacity with blue border
  - Drop target: Blue border with light blue background

### Layout
```
┌─────────────────────────────────────────────────┐
│  ⋮⋮  Product Name                   $100.00  🗑️ │
│      Qty: 2 units × $50.00 ✏️                   │
└─────────────────────────────────────────────────┘
```

### Editing State
When editing quantity:
```
┌─────────────────────────────────────────────────┐
│  ⋮⋮  Product Name                   $100.00  🗑️ │
│      Qty: [2____] units [Save] [Cancel]         │
└─────────────────────────────────────────────────┘
```

### Dragging State
Visual feedback while dragging:
```
┌─────────────────────────────────────────────────┐
│  ⋮⋮  Product A (being dragged - 50% opacity)   │
└─────────────────────────────────────────────────┘
        ↓
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  ⋮⋮  Drop here (blue highlight)                 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

## Technical Implementation

### New State Variables
```typescript
const [editingQuantityIndex, setEditingQuantityIndex] = useState<number | null>(null);
const [tempQuantity, setTempQuantity] = useState("");
const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
```

### New Functions

#### Drag & Drop Functions
1. **handleDragStart(index: number)**
   - Initiates drag operation
   - Stores the index of the dragged item

2. **handleDragOver(e: React.DragEvent, index: number)**
   - Prevents default to allow drop
   - Updates visual indicator for drop target

3. **handleDragLeave()**
   - Clears drop target indicator

4. **handleDrop(e: React.DragEvent, dropIndex: number)**
   - Executes the reorder operation
   - Removes item from original position
   - Inserts item at new position
   - Clears drag state

5. **handleDragEnd()**
   - Cleanup function to reset drag state

#### Edit/Delete Functions
6. **deletePreviewProduct(index: number)**
   - Removes product at specified index
   - Recalculates all totals
   - Clears preview if no items remain

7. **startEditingQuantity(index: number, currentQuantity: number)**
   - Activates edit mode for specified product
   - Populates input with current quantity

8. **saveEditedQuantity(index: number)**
   - Validates input (must be >= 0.01)
   - Updates quantity and line total
   - Recalculates all totals
   - Shows success notification

9. **cancelEditingQuantity()**
   - Exits edit mode without saving changes

10. **editPreviewProductQuantity(index: number, newQuantity: number)**
    - Core logic for updating quantity
    - Recalculates line total and all quote totals

#### Chat Management Function
11. **clearChat()**
    - Shows confirmation dialog
    - Deletes all chat messages from database
    - Resets all state variables (messages, suggested products, preview, etc.)
    - Shows fresh welcome message
    - Displays success notification

### Automatic Recalculation
When any change is made (quantity edit or deletion), the system automatically recalculates:
```typescript
const subtotal = updatedItems.reduce((sum, item) => sum + item.line_total, 0);
const tax_amount = subtotal * quotePreview.tax_rate;
const total_price = subtotal + tax_amount - quotePreview.discount_amount;
```

## User Workflow

### Drag & Drop Reordering
1. Hover over a product in the preview tab
2. Click and hold the grip handle (⋮⋮) on the left side
3. Drag the product to desired position
4. Visual feedback shows:
   - Dragged item becomes semi-transparent
   - Drop target highlights with blue border
5. Release to drop in new position
6. Product order updates immediately

### Editing Quantity
1. Hover over a product in the preview tab
2. Click the blue edit icon (✏️) next to the quantity
3. Input field appears with current quantity
4. Enter new quantity
5. Press Enter or click Save
6. Totals automatically update

### Deleting Product
1. Hover over a product in the preview tab
2. Click the red trash icon (🗑️)
3. Confirm deletion in dialog
4. Product is removed and totals update

### Clearing Chat
1. Notice the chat header appears once you have messages
2. Click the "Clear Chat" button in the header
3. Confirm you want to clear everything
4. All messages, suggested products, and quote preview are removed
5. Fresh welcome message appears
6. Start building a new quote from scratch

## Keyboard Shortcuts
- **Enter**: Save quantity when editing
- **Escape**: Cancel quantity edit

## Error Handling
- Invalid quantity (< 0.01): Shows error toast
- NaN input: Shows "Please enter a valid quantity" error
- Empty preview after delete: Returns to "No preview available" state

## Benefits
1. **Flexibility**: Users can fine-tune quotes without restarting the chat
2. **Efficiency**: Make quick adjustments without AI interaction
3. **Control**: Full control over product order and quantities through drag-and-drop
4. **Professional**: Create polished quotes with proper ordering
5. **User-Friendly**: Intuitive drag-and-drop, hover states, and inline editing
6. **Modern UX**: Smooth animations and visual feedback during interactions
7. **Reset Capability**: Easy way to start over when scope changes or errors occur
8. **Context Awareness**: Clear Chat button only appears when needed (messages exist)

## Future Enhancements (Not Implemented)
- Touch-friendly drag-and-drop for mobile devices
- Bulk delete (select multiple items)
- Edit product name and unit price
- Duplicate line item
- Add notes to individual line items
- Undo/redo functionality
- Keyboard shortcuts for reordering (Arrow keys + modifier)
- Multi-select drag-and-drop

