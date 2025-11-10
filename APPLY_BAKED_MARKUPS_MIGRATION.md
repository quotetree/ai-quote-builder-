# Apply Baked Markups Migration - URGENT

## Problem
You're seeing errors when submitting quotes with baked markups:
- ❌ "Could not find the 'bakedMarkups' column of 'quotes' in the schema cache"
- ❌ `[submitQuote] Error: {}`
- ❌ Error type: "object"

## Root Cause
The database migration for `baked_markups` column hasn't been applied yet.

## Solution: Apply the Migration NOW

### Step 1: Open Supabase SQL Editor
1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Click **SQL Editor** in the left sidebar

### Step 2: Run the Migration
Copy and paste this SQL into the editor:

```sql
-- Add bakedMarkups column to quotes table to persist markup configurations
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS baked_markups JSONB DEFAULT '[]';

-- Add index for queries that filter by baked markups
CREATE INDEX IF NOT EXISTS idx_quotes_baked_markups ON quotes USING GIN (baked_markups);

-- Add comment explaining the column
COMMENT ON COLUMN quotes.baked_markups IS 'Array of BakedMarkupConfig objects containing markup rules with base/addTo selectors, distribution methods, and computed per-item deltas';
```

### Step 3: Execute
1. Click **Run** (or press Cmd+Enter / Ctrl+Enter)
2. You should see: **Success. No rows returned**

### Step 4: Verify
Run this query to confirm the column exists:

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

### Step 5: Restart Your Dev Server
```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
```

## After Migration

### Test It Works
1. Create a quote with items
2. Click "+ Add Markup"
3. Add a markup (e.g., 5% on all items)
4. Click "Submit Quote"
5. **Expected**: ✅ Quote saves successfully with no errors

### Check the Database
```sql
SELECT id, quote_name, baked_markups
FROM quotes
WHERE baked_markups IS NOT NULL AND baked_markups != '[]'::jsonb
LIMIT 5;
```

You should see your saved markups as JSON data.

## Troubleshooting

### Error: "column already exists"
✅ **Good!** This means the migration already ran. Just restart your dev server.

### Error: "permission denied"
❌ You need admin/owner permissions on the database. Contact your Supabase project owner.

### Still seeing schema cache errors?
1. Clear browser cache
2. Hard refresh (Cmd+Shift+R / Ctrl+Shift+R)
3. Restart dev server
4. Check if you're connected to the correct Supabase project

## Why This Migration?

The `baked_markups` column stores the markup configuration as JSON:
```json
[
  {
    "id": "markup-1234567890",
    "label": "Overhead",
    "percent": 0.05,
    "baseSelector": { "include": "all" },
    "addToSelector": { "include": "all" },
    "distribution": "proportional",
    "rounding": { "mode": "bankers", "places": 2 },
    "audited": {
      "base": 1000,
      "totalMarkup": 50,
      "perItemDeltas": { "item-1": 30, "item-2": 20 }
    },
    "createdAt": "2024-11-10T...",
    "createdBy": "user-uuid"
  }
]
```

This allows:
- ✅ Persistence across sessions
- ✅ Edit mode rehydration
- ✅ Audit trail of markup rules
- ✅ Version history

## Next Steps

After applying the migration:
1. ✅ Submit a quote with markups → should work
2. ✅ Edit the quote → markups should reappear
3. ✅ Check console → no more "column not found" errors
4. ✅ Verify data in database → markups stored as JSON

