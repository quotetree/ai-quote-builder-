# Quick Start: Working State Persistence

## The Fix is Complete! ✅

Your issue is now fixed. When you navigate between projects:
- ✅ Chat messages persist
- ✅ **Suggested products persist** (NEW!)
- ✅ **Quote preview persists** (NEW!)
- ✅ **Split view state persists** (NEW!)

## 🚀 To Activate This Fix

### Step 1: Apply the Database Migration

You MUST run this migration in your Supabase database:

#### **Easiest Method: Supabase Dashboard**

1. Open your Supabase project: https://supabase.com/dashboard
2. Go to **SQL Editor** (left sidebar)
3. Click **"New Query"**
4. Copy and paste this SQL:

```sql
-- Create table to store project working state
CREATE TABLE IF NOT EXISTS project_working_state (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL UNIQUE,
  suggested_products JSONB DEFAULT '[]',
  quote_preview JSONB DEFAULT NULL,
  show_split_view BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX idx_project_working_state_project_id ON project_working_state(project_id);

-- Enable RLS
ALTER TABLE project_working_state ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access working state for their own projects
CREATE POLICY "Users can manage their own project working state"
  ON project_working_state
  FOR ALL
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_project_working_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_update_project_working_state_updated_at
  BEFORE UPDATE ON project_working_state
  FOR EACH ROW
  EXECUTE FUNCTION update_project_working_state_updated_at();
```

5. Click **"Run"** (or press Cmd/Ctrl + Enter)
6. You should see "Success. No rows returned"

### Step 2: Verify It Works

After running the migration:

1. **Refresh your app** in the browser
2. Open a project
3. Chat with AI to get suggested products
4. Apply some products to the preview
5. **Navigate to a different project**
6. **Navigate back**
7. ✅ Everything should still be there!

## 📋 Quick Test Checklist

- [ ] Migration applied successfully
- [ ] Can see suggested products persist across navigation
- [ ] Can see quote preview persist across navigation
- [ ] Split view state persists
- [ ] Works after browser refresh
- [ ] Works after logout/login
- [ ] Clear chat properly resets everything
- [ ] Submit quote properly resets everything

## ❓ Troubleshooting

### "No changes detected" or nothing persists

1. Check browser console for errors
2. Verify migration was applied: Run this in SQL Editor:
   ```sql
   SELECT COUNT(*) FROM project_working_state;
   ```
   If you get an error, the migration didn't apply.

### "Permission denied" errors

The RLS policy might not be set up correctly. Re-run the migration.

### Still having issues?

Check the detailed documentation:
- `WORKING_STATE_PERSISTENCE_FIX.md` - Complete explanation
- `APPLY_WORKING_STATE_MIGRATION.md` - Detailed migration instructions

## 📊 What Happens Behind the Scenes

1. **When you add products**: Auto-saved to database after 500ms
2. **When you navigate away**: State stored in database
3. **When you come back**: State loaded from database
4. **When you clear chat**: State deleted from database
5. **When you submit quote**: State deleted from database (fresh start)

## 🎉 That's It!

Once you apply the migration, everything will work automatically. No code changes needed, no configuration - it just works!

---

**Need Help?** Check the detailed docs or open an issue.


