# Debug: Edit Preview Not Showing Line Items

## Issue
When clicking "Edit" on a quote, the Preview panel shows only the subtotal and total, but no line items are displayed.

## Debugging Steps Added

I've added comprehensive console logging to track the data flow from the database to the UI. Here's what to do:

### Step 1: Open DevTools Console
1. Go to `http://localhost:3008`
2. Open Chrome DevTools (F12 or Right-click → Inspect)
3. Go to the **Console** tab
4. Clear the console (click the 🚫 icon or press Ctrl+L)

### Step 2: Reproduce the Issue
1. Navigate to a project with an existing quote
2. Click the **Log** tab
3. Click **Edit** on any quote
4. Watch the console output carefully

### Step 3: Check Console Output

You should see a sequence of log messages like this:

```
[LogPanel] Starting edit for quote: <quote-id>
[EditSession] Quote fetched: { id: '...', version: 2, isEditing: false, itemCount: 14 }
[EditSession] Snapshot created: { quoteId: '...', itemCount: 14, items: [{name: '...', qty: 5}, ...] }
[EditSession] Rehydrating snapshot: { sessionId: '...', itemCount: 14, items: [{name: '...', qty: 5}, ...] }
[EditSession] Quote preview created: { lineItemCount: 14, lineItems: [{name: '...', qty: 5}, ...], total: 34393.05 }
[EditMode] Working state loaded: { hasQuotePreview: true, lineItemCount: 14, lineItems: [{name: '...', qty: 5}, ...] }
[EditMode] Quote rehydrated into preview
```

### Step 4: Identify Where Data is Lost

Check each log message and look for where the count drops to 0:

#### ✅ **Scenario A: Data Never Loads from Database**
If you see:
```
[EditSession] Quote fetched: { id: '...', version: 2, isEditing: false, itemCount: 0 }
```
**Problem:** The quote_items aren't being loaded from the database.
**Possible cause:** The nested query isn't working, or the quote has no items saved.

#### ✅ **Scenario B: Snapshot Created But Items Missing**
If you see:
```
[EditSession] Snapshot created: { quoteId: '...', itemCount: 0, items: [] }
```
**Problem:** The snapshot is being created without items even though the quote had them.
**Possible cause:** The `quote.items` field is undefined or empty.

#### ✅ **Scenario C: Rehydration Fails**
If you see:
```
[EditSession] Rehydrating snapshot: { sessionId: '...', itemCount: 0, items: [] }
```
**Problem:** The snapshot was saved to the database without items, or it's being retrieved incorrectly.
**Possible cause:** JSON serialization issue with Supabase JSONB column.

#### ✅ **Scenario D: Quote Preview Created Without Items**
If you see:
```
[EditSession] Quote preview created: { lineItemCount: 0, lineItems: [], total: 34393.05 }
```
**Problem:** The conversion from snapshot items to quote preview line_items is failing.
**Possible cause:** The mapping logic has an issue.

#### ✅ **Scenario E: Working State Doesn't Load in UI**
If you see:
```
[EditMode] Working state loaded: { hasQuotePreview: true, lineItemCount: 0, lineItems: [] }
```
**Problem:** The quote preview is in the database but without line items.
**Possible cause:** The upsert to project_working_state isn't saving the line_items.

### Step 5: Check Supabase Data Directly

If the console logs show items are being created but not displayed, check the database:

1. Go to your Supabase Dashboard
2. Open the **SQL Editor**
3. Run this query to check the snapshot:

```sql
SELECT 
  qes.id as session_id,
  qes.quote_id,
  jsonb_array_length(qes.snapshot->'items') as item_count,
  qes.snapshot->'items' as items,
  qes.created_at
FROM quote_edit_sessions qes
WHERE qes.status = 'active'
ORDER BY qes.created_at DESC
LIMIT 1;
```

4. Run this query to check the working state:

```sql
SELECT 
  pws.project_id,
  pws.edit_mode,
  pws.current_edit_session_id,
  jsonb_array_length(pws.quote_preview->'line_items') as line_item_count,
  pws.quote_preview->'line_items' as line_items,
  pws.updated_at
FROM project_working_state pws
WHERE pws.edit_mode = true
ORDER BY pws.updated_at DESC
LIMIT 1;
```

### Step 6: Report Back

Copy and paste the **entire console output** starting from when you clicked "Edit" and share it with me. Include:
- ✅ All `[EditSession]` messages
- ✅ All `[EditMode]` messages  
- ✅ Any errors (red text)
- ✅ The results of the SQL queries (if applicable)

---

## Expected Behavior

When everything works correctly, you should see:
1. **itemCount** stays the same (e.g., 14) through all steps
2. **line_items** array contains objects with `product_name` and `quantity`
3. The Preview panel displays all line items

## Possible Quick Fix

If the issue is that the snapshot isn't including items, we might need to adjust the Supabase query or the snapshot structure. The debugging output will tell us exactly where the problem is.

---

**After you test this, please share the console output!** 🔍

