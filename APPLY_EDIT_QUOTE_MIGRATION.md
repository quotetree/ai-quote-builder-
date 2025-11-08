# Apply Edit Quote Migration

## ⚠️ You Need to Apply the Database Migration

The Edit Quote feature requires new database tables and columns. You're seeing an error because the migration hasn't been applied yet.

## 🚀 Quick Fix (2 minutes)

### Option 1: Via Supabase Dashboard (Recommended)

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project

2. **Open SQL Editor**
   - Click "SQL Editor" in the left sidebar
   - Click "New query"

3. **Copy the Migration**
   - Open the file: `supabase/migrations/20241107_add_quote_edit_sessions.sql`
   - Copy ALL the contents (Cmd+A, Cmd+C)

4. **Paste and Run**
   - Paste into the SQL Editor
   - Click "Run" button (or press Cmd+Enter)
   - Wait for "Success" message

5. **Refresh Your App**
   - Go back to your app at http://localhost:3008
   - Refresh the page (Cmd+R)
   - Try clicking Edit button again

### Option 2: Via Supabase CLI

If you have the Supabase CLI installed:

```bash
# Make sure you're in the project directory
cd /Users/samuelbettencourt/Desktop/cursor-projects/quote-tree-ai

# Apply the migration
supabase db push

# Or apply just this migration
supabase migration up
```

### Option 3: Via psql

If you have direct database access:

```bash
psql "postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT].supabase.co:5432/postgres" -f supabase/migrations/20241107_add_quote_edit_sessions.sql
```

## ✅ Verify Migration Applied

After applying, refresh your app and click the Edit button again. You should see:
- Yellow "Editing..." banner appears
- Quote loads into preview panel
- No error in console

## 🔍 Check Migration Status

You can verify the migration was applied by running this in SQL Editor:

```sql
-- Check if tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('quote_edit_sessions', 'quote_version_history');

-- Check if new columns exist on quotes
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'quotes' 
AND column_name IN ('is_editing', 'edit_session_id', 'parent_quote_id');

-- Check if new columns exist on project_working_state
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'project_working_state' 
AND column_name IN ('edit_mode', 'current_edit_session_id');
```

You should see:
- 2 tables: `quote_edit_sessions`, `quote_version_history`
- New columns on `quotes` table
- New columns on `project_working_state` table

## 📋 What the Migration Does

The migration adds:
- **2 new tables** for session and version tracking
- **6 new columns** to the `quotes` table
- **5 new columns** to the `project_working_state` table
- Indexes for performance
- RLS policies for security
- Triggers for auto-versioning

## ❓ Still Having Issues?

If you still see errors after applying the migration:

1. **Check browser console** for detailed error messages
2. **Verify tables exist** using the SQL queries above
3. **Refresh the page** (hard refresh: Cmd+Shift+R)
4. **Restart dev server** (stop and run `npm run dev` again)

## 📚 More Info

- Full implementation docs: `EDIT_QUOTE_IMPLEMENTATION.md`
- Quick start guide: `EDIT_QUOTE_QUICK_START.md`
- Migration file: `supabase/migrations/20241107_add_quote_edit_sessions.sql`

