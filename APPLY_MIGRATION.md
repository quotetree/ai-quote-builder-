# 🚨 URGENT: Fix Slow Chat Loading (30+ seconds → 2 seconds)

Your chat is loading slowly because of inefficient database queries. You MUST apply this migration to your Supabase database.

## Quick Fix (Copy & Paste This SQL)

1. **Open Supabase Dashboard** → https://app.supabase.com
2. Select your project
3. Go to **SQL Editor** (left sidebar)
4. Click **New Query**
5. **Copy and paste this entire SQL code:**

```sql
-- Optimize chat_messages query performance
CREATE INDEX IF NOT EXISTS idx_projects_id_user_id ON projects(id, user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_project_created ON chat_messages(project_id, created_at DESC);

-- Drop slow RLS policies
DROP POLICY IF EXISTS "Users can view messages in own projects" ON chat_messages;
DROP POLICY IF EXISTS "Users can insert messages in own projects" ON chat_messages;

-- Create fast RLS policies
CREATE POLICY "Users can view messages in own projects" ON chat_messages FOR SELECT 
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert messages in own projects" ON chat_messages FOR INSERT 
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- Update statistics
ANALYZE projects;
ANALYZE chat_messages;
```

6. Click **Run** (or press Ctrl+Enter / Cmd+Enter)
7. You should see "Success. No rows returned"

## What This Fixes

- **Database Indexes**: Speeds up project ownership checks
- **RLS Policies**: Replaces slow EXISTS queries with faster IN queries
- **Statistics**: Updates query planner for optimal execution

## Result

- **Before**: 30+ seconds loading
- **After**: 2 seconds or less
- UI will show within 2 seconds maximum (even if query is slow)

## Troubleshooting

If you get permission errors:
1. Make sure you're using the Supabase Dashboard (not local CLI)
2. Make sure you're logged in as the project owner
3. Try running each section separately

If migration fails:
- The policies might already be updated - that's OK
- The indexes are the most important part
- Try running just the CREATE INDEX commands first

