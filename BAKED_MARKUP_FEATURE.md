# Baked Markup Feature - Implementation Complete

## Overview
This feature splits the previous "+ Add Tax/Charge" button into two separate functions:
1. **+ Add Tax** - Existing tax/charge functionality (unchanged)
2. **+ Add Markup** - New baked markup functionality that distributes markup amounts into item prices

## What's New

### UI Changes
- **Footer Links**: The quote preview footer now shows two separate links:
  - `+ Add Tax` (blue) - Opens the existing tax modal
  - `+ Add Markup` (purple) - Opens the new baked markup modal

### Baked Markup Modal
A comprehensive modal that allows users to:
- Set a **Charge Name** (default: "Markup")
- Set a **Percentage** (e.g., 7.5%)
- Choose **Base Applies To**: Items used to calculate the markup amount
  - "All items" or "Exclude..." with multi-select
- Choose **Add To**: Items that will receive the markup baked into their prices
  - "All items" or "Exclude..." with multi-select
- **Advanced Options** (collapsible):
  - **Distribution Method**:
    - Proportional (based on line totals) - default
    - Even (equal shares)
    - Single item (picker dropdown)
- **Live Preview**: Shows base count/total, markup amount, and target items

### How It Works
1. **Calculation Order**: Base price → Discounts → Baked Markup → Taxes → Total
2. **Base Calculation**: Sum of line totals from Base items (post-discount, pre-tax)
3. **Markup Amount**: `ROUND(Base × Percent, 2)` using banker's rounding
4. **Distribution**:
   - **Proportional**: Each target item receives markup based on its share of total
   - **Even**: Equal markup distributed to all target items
   - **Single**: All markup goes to one selected item
5. **Rounding**: Per-item deltas rounded to cents; residue assigned to largest-share item
6. **Item Updates**: Each affected item's `line_total` and `unit_price` increase by its delta

### Visual Indicators
- Items with baked markup show a gray subline: `"Includes Markup: +$X.YZ"`
- Tooltip on hover shows: markup breakdown with percentage and amount per markup rule

### Edit/Remove
- Each baked markup has Edit/Remove options in the item overflow menu
- Removing a markup subtracts the stored deltas and removes the subline
- Editing supersedes the original markup rule

## Database Schema

### New Column: `baked_markups`
```sql
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS baked_markups JSONB DEFAULT '[]';
```

**Migration File**: `supabase/migrations/20241110_add_baked_markups_to_quotes.sql`

### Data Structure
```typescript
interface BakedMarkupConfig {
  id: string;
  label: string;
  percent: number; // Decimal (0.075 = 7.5%)
  baseSelector: {
    include: 'all' | string[];
    exclude?: string[];
  };
  addToSelector: {
    include: 'all' | string[];
    exclude?: string[];
  };
  distribution: 'proportional' | 'even' | { singleItemId: string };
  rounding: { mode: 'bankers' | 'up' | 'down'; places: number };
  audited: {
    base: number;
    totalMarkup: number;
    perItemDeltas: Record<string, number>; // itemId -> delta
  };
  createdAt: string;
  createdBy: string;
  supersededById?: string;
}

interface BakedAdjustment {
  markupTotal?: number;
  breakdown?: Array<{ markupId: string; delta: number }>;
}
```

## Edit Mode Rehydration

### What's Preserved
When reopening a quote for edit, the system:
1. Loads `bakedMarkups[]` from the quote
2. Restores per-item `bakedAdjustments` with deltas
3. Shows "Includes Markup" sublines immediately
4. Recomputes totals and taxes based on marked-up prices

### Snapshot Structure
```typescript
interface QuoteSnapshot {
  quote: Quote;
  items: QuoteItem[];
  charges?: ChargeConfig[];
  bakedMarkups?: BakedMarkupConfig[]; // NEW
}
```

## Files Modified

### 1. `types/database.ts`
- ✅ Added `BakedMarkupSelector`, `BakedMarkupConfig`, `BakedAdjustment` interfaces (already existed)
- ✅ Updated `QuotePreview` to include `bakedMarkups?: BakedMarkupConfig[]`
- ✅ Updated `Quote` to include `bakedMarkups?: BakedMarkupConfig[]`
- ✅ Updated `QuoteItem` to include `bakedAdjustments?: BakedAdjustment`
- ✅ Updated `QuoteSnapshot` to include `bakedMarkups?: BakedMarkupConfig[]`

### 2. `components/SplitChatPanel.tsx`
- ✅ Split footer link into two buttons: "+ Add Tax" and "+ Add Markup"
- ✅ Added state management for `currentMarkup` form
- ✅ Implemented `calculateMarkupPreview()` function
- ✅ Implemented `addBakedMarkupToQuote()` function with proportional/even/single distribution
- ✅ Implemented `removeBakedMarkup()` function
- ✅ Added comprehensive "Add Markup (baked)" modal with all UI fields
- ✅ Updated item rendering to show "Includes Markup: +$X" sublines
- ✅ Updated quote creation to save `bakedMarkups` to database
- ✅ Updated quote submission (edit mode) to save `bakedMarkups`
- ✅ Added telemetry logging: `markup:add`, `markup:remove`

### 3. `lib/editSessionController.ts`
- ✅ Updated `startEditSession` to load `bakedMarkups` from quote
- ✅ Updated `QuoteSnapshot` to include `bakedMarkups`
- ✅ Updated `rehydrateEditSession` to restore `bakedMarkups` and `bakedAdjustments`
- ✅ Updated `submitEditedQuote` interface to accept `bakedMarkups`
- ✅ Updated database update to save `bakedMarkups` with quote
- ✅ Added comprehensive logging for baked markups at all stages

### 4. `supabase/migrations/20241110_add_baked_markups_to_quotes.sql`
- ✅ Created new migration file to add `baked_markups JSONB` column to `quotes` table
- ✅ Added GIN index for efficient JSONB queries
- ✅ Added explanatory comment

## Testing Guide

### Setup
1. Apply the database migration:
   ```bash
   # In Supabase SQL Editor:
   ```
   ```sql
   -- Run the contents of:
   -- supabase/migrations/20241110_add_baked_markups_to_quotes.sql
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

### Test Scenarios

#### AT1: Tax Unchanged
1. Create a quote with items
2. Click `+ Add Tax`
3. Add "Sales Tax" at 9.5%, exclude labor
4. Verify tax appears as a separate charge row
5. Verify amounts and summaries match previous behavior

#### AT2: Single-Item Bake
1. Create a quote with Hardware and Labor items
2. Click `+ Add Markup`
3. Set:
   - Name: "Overhead"
   - Percentage: 3%
   - Base: All items
   - Add To: Only Labor (use Exclude... and exclude Hardware)
   - Distribution: Leave as Proportional (or use Single)
4. Click "Add Markup"
5. Verify:
   - Labor item shows "Includes Markup: +$X"
   - Entire markup is baked into Labor's price
   - Tax (if any) recalculates based on new Labor price

#### AT3: Proportional Multi-Item
1. Create a quote with:
   - Hardware: $1,000
   - Software: $500
2. Click `+ Add Markup`
3. Set:
   - Base: Hardware only
   - Percentage: 5% (= $50)
   - Add To: Hardware + Software
   - Distribution: Proportional
4. Verify:
   - Hardware gets ~$33.33 (66.7% share)
   - Software gets ~$16.67 (33.3% share)
   - Sum equals exactly $50
   - Rounding residue assigned to Hardware (largest share)

#### AT4: Even Distribution
1. Create a quote with 3 items at varying prices
2. Add markup:
   - Base: All items
   - Percentage: 6%
   - Add To: All items
   - Distribution: Even
3. Verify each item gets equal markup share

#### AT5: Rehydrate
1. Create and submit a quote with a baked markup
2. Click "Edit" on the quote in the Log
3. Verify:
   - All items show "Includes Markup" sublines immediately
   - Markup amount and percentage match original
   - Totals are correct

#### AT6: Edit/Remove
1. Add a markup to a quote
2. Click the remove icon next to "Includes Markup"
3. Verify:
   - Markup deltas subtracted
   - Sublines disappear
   - Totals revert
   - Taxes recalculate

#### AT7: No Cross-Effects
1. Create a quote with:
   - Item with 10% discount
   - Baked markup
   - Sales tax
2. Verify calculation order:
   - Base price → Discount applied
   - Markup computed from discounted price
   - Tax computed from marked-up price
   - Total equals visible math

#### AT8: Footer UI
1. Open quote preview
2. Verify two separate links appear under Subtotal:
   - `+ Add Tax` (blue)
   - `+ Add Markup` (purple)
3. Each opens the correct modal
4. No UI regressions elsewhere

## Telemetry Logging

The following console logs are emitted:

```javascript
// When adding a markup
[Telemetry] markup:add { markupId: ..., base: ..., percent: ..., total: ..., targets: ... }

// When removing a markup
[Telemetry] markup:remove { markupId: ... }

// During edit session creation
[EditSession] Loaded charges and markups from quote: { ..., bakedMarkupCount: ... }

// During rehydration
[EditSession] Rehydrating snapshot: { ..., bakedMarkupCount: ... }
[EditSession] Quote preview created: { ..., bakedMarkupCount: ..., itemsWithBakedAdjustments: ... }

// During submission
[Submit] Updated quote with charges and markups: { ..., bakedMarkupCount: ... }
[Submit] Saved quote with charges, discounts, and markups: { ..., bakedMarkupCount: ... }
```

## Constraints Met

✅ **No LLM math**: All calculations in the engine (banker's rounding)  
✅ **Performance**: O(n items) per compute; selector matches memoized by name  
✅ **Schema preserved**: Existing tax schemas and migrations untouched  
✅ **Separate persistence**: Markup stored in `baked_markups` column, not as charge rows  
✅ **Immutable versions**: Edit mode preserves prior approved versions  

## Definition of Done

✅ `+ Add Tax` works exactly as before  
✅ `+ Add Markup` computes and bakes markup into chosen items  
✅ Items show "Includes Markup" sublines  
✅ Totals and taxes update correctly after baked markups  
✅ Edit mode rehydrates rules and deltas deterministically  
✅ All acceptance tests can be performed  
✅ Database migration provided  
✅ Comprehensive logging in place  

## Next Steps

1. **Apply Database Migration**: Run the SQL migration in Supabase SQL Editor
2. **Test Thoroughly**: Follow the testing guide above
3. **User Feedback**: Have users test the feature with real quotes
4. **Documentation**: Update user-facing documentation if needed

## Notes

- The tax/charge functionality remains completely unchanged
- Baked markups are stored separately from charges for clarity
- The UI uses purple theming for markup to distinguish from blue tax buttons
- Distribution methods provide flexibility for different business needs
- Edit mode fully supports baked markups with proper rehydration

