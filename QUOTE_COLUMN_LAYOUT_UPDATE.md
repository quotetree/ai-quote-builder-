# Quote Column Layout Update

## Overview

Updated the quote PDF export to display a more detailed pricing breakdown with separate List Price and Sales Price columns.

## Changes

### Previous Column Layout
- Product
- **Unit Price** (sales price with discount already applied)
- Discount
- Quantity
- Total Price

### New Column Layout
- Product
- **List Price** (base price before discount)
- Discount (%)
- **Sales Price** (with discount applied to list price)
- Quantity
- Total Price (sales price × quantity)

## Implementation Details

### File Modified
- `app/api/quotes/pdf/route.ts`

### Changes Made

**1. Added List Price Column**
```typescript
const listPrice = safeNumber(item.list_price) || safeNumber(item.unit_price);
```
- Shows the base list price before any discounts
- Falls back to `unit_price` if `list_price` is not set
- Provides transparency in pricing

**2. Renamed "Unit Price" to "Sales Price"**
```typescript
const salesPrice = item.quantity > 0 ? item.line_total / item.quantity : item.unit_price;
```
- Calculates from `line_total / quantity`
- **Preserves markup functionality** (important!)
- Shows the actual price customer pays per unit after discounts/markups

**3. Updated Table Headers**
```typescript
head: [["Product", "List Price", "Discount", "Sales Price", "Quantity", "Total Price"]]
```

**4. Updated Column Alignment**
```typescript
columnStyles: {
  1: { halign: "right" },  // List Price
  2: { halign: "center" }, // Discount
  3: { halign: "right" },  // Sales Price
  4: { halign: "center" }, // Quantity
  5: { halign: "right" },  // Total Price
}
```

## Markup Handling

**CRITICAL:** Markups are hidden from customers!

### How It Works

1. **Sales Price** is calculated from `line_total / quantity`
   - Includes all markups, discounts, and adjustments
   - This is what the customer actually pays

2. **List Price** is back-calculated to hide markup:
   ```
   displayListPrice = salesPrice / (1 - discount_percent)
   ```
   - If discount is 20% and sales price is $800
   - Display List Price = $800 / 0.8 = $1,000
   - Customer sees: "$1,000 - 20% = $800" ✓

### Why This Matters

**Without back-calculation:**
```
Real List Price: $500
Markup: +$200 (hidden from customer)
Sales Price: $700
Discount: 20%

Customer sees:
List Price: $500
Discount: 20%
Sales Price: $700
❌ Math doesn't work: $500 * 0.8 = $400, not $700!
```

**With back-calculation:**
```
Real List Price: $500
Markup: +$200 (hidden from customer)
Sales Price: $700
Discount: 20%

Customer sees:
List Price: $875 (back-calculated)
Discount: 20%
Sales Price: $700
✅ Math works: $875 * 0.8 = $700!
```

### Result
- Markup is completely hidden from customer
- Pricing math appears correct
- Customer sees logical discount flow
- Professional presentation

## Example

### Before
| Product | Unit Price | Discount | Quantity | Total Price |
|---------|------------|----------|----------|-------------|
| Camera  | $3,279.20  | 20%      | 2        | $6,558.40   |

**Problem:** Hard to see original price vs. discounted price.

### After
| Product | List Price | Discount | Sales Price | Quantity | Total Price |
|---------|------------|----------|-------------|----------|-------------|
| Camera  | $3,279.20  | 20%      | $2,623.36   | 2        | $5,246.72   |

**Benefit:** Clear pricing breakdown showing discount impact.

## Testing

### Test Case 1: Product with Discount
```
List Price: $1,000.00
Discount: 20%
Expected Sales Price: $800.00
Expected Total (qty 2): $1,600.00
```

### Test Case 2: Product with Markup
```
List Price: $500.00
Markup: +$100.00
Discount: 10%
Expected Sales Price: $600.00 (markup applied, then discount)
Expected Total (qty 1): $600.00
```

### Test Case 3: Product without Discount
```
List Price: $300.00
Discount: 0%
Expected Sales Price: $300.00
Expected Total (qty 3): $900.00
```

## Benefits

1. **Transparency:** Customers see both list price and final sales price
2. **Clarity:** Discount percentage is more meaningful when list price is shown
3. **Professional:** Industry-standard format for B2B quotes
4. **Trust:** Shows pricing breakdown clearly
5. **Markup-Safe:** Preserves all existing markup functionality

## Notes

- Total Price = Sales Price × Quantity
- Sales Price includes all discounts and markups
- List Price is the baseline before any adjustments
- Discount % applies to the List Price
- Markup functionality is completely preserved

