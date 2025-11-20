# Currency Input Typing Bug Fix

## Problem Description

The currency input fields for **List Price** and **Sales Price** in the quote line item table were "fighting" the user while typing. The inputs would constantly reformat on every keystroke, causing values like "5000" to become "5.00" or "205" to become "2.05".

### Specific Issues

1. **Camera labor installation** (list price)
   - Trying to type `$5,000.00` would result in `$5.00`
   - Margin % would become ~99.97% (incorrect)

2. **ADI J Hook 3/4" 25-Pack** (sales price)
   - Trying to type `$205.00` would result in `$2.05`
   - Margin % would blow up to huge negative numbers

### Root Cause

In `components/LogPanel.tsx`, the `ProfitBreakdownView` component was:
- Using `.toLocaleString()` on every render to format the input value
- Parsing and updating state on every keystroke in the `onChange` handler
- This caused the input to constantly reformat, preventing users from typing multi-digit numbers

## Solution

Implemented a **separate editing state** pattern that:

1. **While typing**: Stores the raw string value in local state
2. **On blur**: Parses the value and normalizes it
3. **Display logic**: Shows raw string while editing, formatted value when not editing

### Changes Made

**File**: `components/LogPanel.tsx`

#### 1. Added React import
```typescript
import React, { useState, useEffect, useMemo, useRef } from "react";
```

#### 2. Added editing state management in `ProfitBreakdownView`
```typescript
const [editingFields, setEditingFields] = React.useState<Record<string, string>>({});
```

#### 3. Created helper functions

**`handlePriceInputChange`**: Allows free typing, validates input (digits and one decimal)
```typescript
const handlePriceInputChange = (itemId: string, field: 'list' | 'sales', rawValue: string) => {
  const cleaned = rawValue.replace(/[^0-9.]/g, '');
  const dotCount = (cleaned.match(/\./g) || []).length;
  if (dotCount > 1) return;
  setEditingFields(prev => ({ ...prev, [`${itemId}-${field}`]: cleaned }));
};
```

**`handlePriceInputBlur`**: Parses and normalizes on blur
```typescript
const handlePriceInputBlur = (itemId: string, field: 'list' | 'sales', currentValue: number) => {
  const fieldKey = `${itemId}-${field}`;
  const editValue = editingFields[fieldKey];
  
  if (editValue !== undefined) {
    const numeric = parseFloat(editValue || '0');
    const safeValue = isNaN(numeric) ? 0 : Math.max(0, numeric);
    
    if (field === 'list') {
      onListPriceChange(itemId, safeValue);
    } else {
      onSalesPriceChange(itemId, safeValue);
    }
    
    setEditingFields(prev => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }
};
```

**`getPriceDisplayValue`**: Returns raw string while editing, formatted value otherwise
```typescript
const getPriceDisplayValue = (itemId: string, field: 'list' | 'sales', actualValue: number): string => {
  const fieldKey = `${itemId}-${field}`;
  const editingValue = editingFields[fieldKey];
  
  if (editingValue !== undefined) {
    return editingValue;
  }
  
  return Number.isFinite(actualValue) 
    ? actualValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
};
```

#### 4. Updated input fields
Changed from immediate parsing/formatting to edit-on-type, normalize-on-blur:

```typescript
<input
  type="text"
  inputMode="decimal"
  value={getPriceDisplayValue(row.id, 'list', row.listPrice)}
  onChange={(event) => handlePriceInputChange(row.id, 'list', event.target.value)}
  onBlur={() => handlePriceInputBlur(row.id, 'list', row.listPrice)}
  className="..."
/>
```

## What Was NOT Changed

✅ **No changes to business logic**:
- Margin calculations remain unchanged
- Total, Margin %, Margin $ formulas unchanged
- Discount % calculation unchanged
- All math for `list_price` vs `sales_price` unchanged

## Test Cases

After this fix, the following should work correctly:

### Test 1: Camera labor installation
- Set LIST PRICE to `5000`
- Set SALES PRICE to `16500`
- ✅ Inputs display `$5,000.00` and `$16,500.00`
- ✅ Margin % and Margin $ calculate correctly
- ✅ No snapping to `5.00` or `50.00`

### Test 2: ADI J Hook 3/4" 25-Pack
- Set SALES PRICE to `205`
- ✅ Input displays `$205.00`
- ✅ Margin % and Margin $ calculate correctly
- ✅ No snapping to `2.05`

### Test 3: General typing
- Backspace everything and type `"100"`
- ✅ Works smoothly, displays `$100.00` on blur
- Typing partial values like `"1"`, `"10"`, `"100"`, `"1000"` are not blocked
- ✅ All values work correctly

## How It Works

1. **User clicks into field**: Field shows current formatted value (e.g., `1,234.56`)
2. **User starts typing**: Field switches to raw editing mode, shows unformatted string
3. **User types "5000"**: Field shows `5000` (not reformatted)
4. **User clicks away (blur)**: 
   - Value is parsed to `5000.00`
   - Formatted display updates to `$5,000.00`
   - Margin calculations update with new value

## Branch

Changes made on branch: `fix/currency-input-typing-bug`

To test:
```bash
git checkout fix/currency-input-typing-bug
npm run dev
```

Navigate to a project → Log tab → Click on a quote → Click "Profit Margin" → Try editing List Price or Sales Price fields.

