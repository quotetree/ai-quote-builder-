# Apply Working State Migration

This migration adds persistence for suggested products and quote previews so they remain visible when navigating between projects.

## What This Fixes

Previously, when you navigated away from a project and came back:
- ✅ Chat messages persisted (already working)
- ❌ Suggested products disappeared
- ❌ Quote preview disappeared
- ❌ Split view state was lost

After this migration:
- ✅ Chat messages persist
- ✅ Suggested products persist
- ✅ Quote preview persists
- ✅ Split view state persists

## How to Apply

### Option 1: Using Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy the contents of `supabase/migrations/20241106_add_project_working_state.sql`
5. Paste into the SQL editor
6. Click **Run** to execute the migration

### Option 2: Using Supabase CLI

```bash
# Make sure you're in the project root directory
supabase db push

# Or apply the specific migration file
supabase migration up
```

### Option 3: Manual SQL Execution

If you prefer to run SQL directly, execute the migration file against your database:

```bash
psql -h your-db-host -U your-user -d your-database -f supabase/migrations/20241106_add_project_working_state.sql
```

## Verify Migration Success

After applying the migration, verify it worked:

### 1. Check the Table Exists

Run this query in Supabase SQL Editor:

```sql
SELECT * FROM project_working_state LIMIT 1;
```

You should see the table structure (it will be empty at first).

### 2. Check the Policies

```sql
SELECT * FROM pg_policies WHERE tablename = 'project_working_state';
```

You should see one RLS policy.

### 3. Test in the App

1. Create or open a project
2. Have a chat conversation that generates suggested products
3. Apply some products to the preview
4. Navigate to a different project
5. Navigate back to the original project
6. **Verify**: Chat messages, suggested products, and preview quote are all still there!

## Migration Details

### New Table: `project_working_state`

Stores the current working state for each project:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `project_id` | UUID | Reference to projects table (unique) |
| `suggested_products` | JSONB | Array of product suggestions from AI |
| `quote_preview` | JSONB | Current quote preview with line items and totals |
| `show_split_view` | BOOLEAN | Whether split view should be displayed |
| `created_at` | TIMESTAMPTZ | When record was created |
| `updated_at` | TIMESTAMPTZ | When record was last updated |

### Features

- **One working state per project**: Enforced by UNIQUE constraint on `project_id`
- **Automatic cleanup**: When a project is deleted, its working state is deleted too (CASCADE)
- **Row Level Security**: Users can only access working state for their own projects
- **Auto-update timestamp**: `updated_at` is automatically updated on changes

### Code Changes

Updated files:
- `types/database.ts` - Added TypeScript interfaces for the new table
- `components/SplitChatPanel.tsx` - Added functions to load/save working state
  - `loadWorkingState()` - Loads from database on project load
  - `saveWorkingState()` - Auto-saves when state changes (debounced)
  - Updated `clearChat()` and `submitQuote()` to clear working state

## Rollback (If Needed)

If you need to rollback this migration:

```sql
-- Drop the table and all related objects
DROP TABLE IF EXISTS project_working_state CASCADE;
```

## Troubleshooting

### Error: "relation 'project_working_state' does not exist"

This means the migration hasn't been applied yet. Follow the steps above to apply it.

### Error: "permission denied for table project_working_state"

Check that RLS policies are correctly set up:

```sql
-- View current policies
SELECT * FROM pg_policies WHERE tablename = 'project_working_state';

-- If no policies exist, re-run the RLS section of the migration
```

### Working state not persisting

1. Check browser console for errors
2. Verify the auto-save is triggering (look for "Working state saved to database" in console)
3. Check Supabase logs for any database errors
4. Verify RLS policies allow your user to insert/update

### Performance concerns

The working state is auto-saved with a 500ms debounce, so it won't hammer the database. If you notice performance issues:

1. Check the `project_working_state` table size
2. Verify indexes are created properly
3. Consider increasing the debounce time in `SplitChatPanel.tsx` (line 97)

## Notes

- Working state is automatically cleared when you:
  - Click "Clear Chat"
  - Submit a quote (creates a new quote and resets for next one)
- Working state persists across:
  - Project navigation
  - Browser refresh
  - Logout/login
  - Tab close/reopen


