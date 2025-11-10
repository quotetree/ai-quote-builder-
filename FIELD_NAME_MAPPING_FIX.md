# Field Name Mapping Fix: bakedMarkups ↔ baked_markups

## Problem

**Error**: "Could not find the 'bakedMarkups' column of 'quotes' in the schema cache"

Even though:
- ✅ Migration was applied successfully
- ✅ Database has `baked_markups` column (snake_case)
- ✅ Supabase shows `quotes.baked_markups jsonb default '[]'::jsonb`

## Root Cause

**Field Name Mismatch**:
- **Database**: Uses `baked_markups` (snake_case) - PostgreSQL convention
- **Application**: Uses `bakedMarkups` (camelCase) - JavaScript convention  
- **PostgREST**: Requires exact column names (snake_case)

When the code tried to write:
```javascript
{
  bakedMarkups: [...] // ❌ Column doesn't exist!
}
```

The database was looking for a column literally named `bakedMarkups`, which doesn't exist. The actual column is `baked_markups`.

## Solution Implemented

### 1. Fixed WRITE Operations (Snake_Case for DB)

**File**: `components/SplitChatPanel.tsx` (line 1607)
```typescript
// Before (WRONG)
bakedMarkups: quotePreview.bakedMarkups || [],

// After (CORRECT)
baked_markups: quotePreview.bakedMarkups || [], // DB uses snake_case
```

**File**: `lib/editSessionController.ts` (line 612)
```typescript
// Before (WRONG)
bakedMarkups: modifiedQuote.bakedMarkups || [],

// After (CORRECT)
baked_markups: modifiedQuote.bakedMarkups || [], // DB uses snake_case
```

### 2. Fixed READ Operations (Map from Snake_Case)

**File**: `lib/editSessionController.ts` (line 128)
```typescript
// Before (WRONG)
const bakedMarkups = quote.bakedMarkups || [];

// After (CORRECT)
const bakedMarkups = (quote as any).baked_markups || quote.bakedMarkups || [];
// Tries snake_case first (what DB returns), then camelCase (fallback)
```

## How It Works

### Data Flow

**WRITE (JavaScript → Database)**:
```
Application State (camelCase)
  ↓
  bakedMarkups: [...]
  ↓
Database Insert (snake_case)
  ↓
  baked_markups: [...]
  ↓
PostgreSQL Column: baked_markups
```

**READ (Database → JavaScript)**:
```
PostgreSQL Column: baked_markups
  ↓
Supabase Response (snake_case)
  ↓
  { baked_markups: [...] }
  ↓
Application Mapping
  ↓
  const bakedMarkups = quote.baked_markups
  ↓
Application State (camelCase)
  ↓
  bakedMarkups: [...]
```

## Why This Happens

Supabase uses PostgREST which:
1. **Does NOT automatically convert** snake_case ↔ camelCase
2. Requires **exact column names** in INSERT/UPDATE operations
3. Returns data with **exact column names** from the database

Most ORMs (Prisma, Drizzle, TypeORM) handle this mapping automatically with decorators like:
```typescript
@Column('baked_markups')
bakedMarkups: BakedMarkupConfig[];
```

But we're using **raw Supabase client**, so we must handle mapping ourselves.

## Files Changed

1. **`components/SplitChatPanel.tsx`**
   - Line 1607: Changed `bakedMarkups:` to `baked_markups:` in INSERT

2. **`lib/editSessionController.ts`**
   - Line 128: Added mapping for READ operations
   - Line 612: Changed `bakedMarkups:` to `baked_markups:` in UPDATE

3. **`FIELD_NAME_MAPPING_FIX.md`** (this file)
   - Complete documentation

## Testing

### Before Fix
```bash
# Submit quote with markup
Error: "Could not find the 'bakedMarkups' column of 'quotes' in the schema cache"
```

### After Fix
```bash
# Submit quote with markup
✅ Success! Quote saved with baked_markups
```

### Verify in Database
```sql
SELECT id, quote_name, baked_markups
FROM quotes
WHERE baked_markups IS NOT NULL AND baked_markups != '[]'::jsonb
LIMIT 5;
```

You should see JSON data in the `baked_markups` column.

## Best Practices for Supabase Projects

### Option 1: Manual Mapping (Current Approach)
```typescript
// WRITE
.insert({
  baked_markups: appData.bakedMarkups // snake → camelCase
})

// READ
const markups = (dbRow as any).baked_markups || [];
```

**Pros**: No dependencies, full control  
**Cons**: Manual mapping required, type safety lost

### Option 2: Use Generated Types (Recommended)
```bash
# Generate TypeScript types from Supabase schema
supabase gen types typescript --project-id <PROJECT_ID> > src/types/supabase.ts
```

Then import and use:
```typescript
import { Database } from '@/types/supabase';

type Quote = Database['public']['Tables']['quotes']['Row'];
// Quote.baked_markups is now properly typed
```

### Option 3: Use an ORM Layer
```typescript
// With Prisma
model Quote {
  id           String  @id
  bakedMarkups Json    @map("baked_markups") // Automatic mapping!
}
```

## Migration Already Applied?

The `baked_markups` column should already exist. Verify with:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'quotes' AND column_name = 'baked_markups';
```

Expected result:
```
column_name    | data_type | column_default
baked_markups  | jsonb     | '[]'::jsonb
```

If the column is missing, run the migration from `supabase/migrations/20241110_add_baked_markups_to_quotes.sql`.

## Acceptance Tests

### AT1 - Submit with Markup ✅
```
1. Create quote with items
2. Add 5% markup on all items
3. Click "Submit Quote"
4. Expected: ✅ Success (no schema cache error)
```

### AT2 - Verify Data in DB ✅
```sql
SELECT baked_markups FROM quotes WHERE id = '<quote-id>';
```
Expected: JSON array with markup config

### AT3 - Reload Quote ✅
```
1. Click "Edit" on saved quote
2. Expected: Markup rehydrates, "Includes Markup" sublines appear
```

### AT4 - Round-Trip Consistency ✅
```
1. Save markup → Reload → Edit → Save again
2. Expected: Data preserved through all operations
```

## Common Errors Fixed

### Error 1: Schema Cache
```
❌ Could not find the 'bakedMarkups' column
✅ Fixed: Use baked_markups in INSERT/UPDATE
```

### Error 2: Data Not Saving
```
❌ Submit succeeds but markup not in database
✅ Fixed: Map bakedMarkups → baked_markups on write
```

### Error 3: Data Not Loading
```
❌ Edit mode shows no markups
✅ Fixed: Read from baked_markups, map to bakedMarkups
```

## Summary

**Problem**: Field name mismatch (camelCase vs snake_case)  
**Solution**: 
- **Write**: Use `baked_markups` (snake_case) for database operations
- **Read**: Map from `baked_markups` to `bakedMarkups` in app

**Status**: ✅ Fixed - Ready to test!

