-- Optimize chat_messages query performance
-- Add composite index for faster RLS policy checks

-- Create composite index on projects for faster ownership verification
CREATE INDEX IF NOT EXISTS idx_projects_id_user_id ON projects(id, user_id);

-- Create index on chat_messages created_at for faster ordering
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(project_id, created_at);

-- Add an index to improve the chat messages RLS policy performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_project_created ON chat_messages(project_id, created_at DESC);

-- Drop the old slow RLS policies for chat_messages
DROP POLICY IF EXISTS "Users can view messages in own projects" ON chat_messages;
DROP POLICY IF EXISTS "Users can insert messages in own projects" ON chat_messages;

-- Create optimized RLS policies using the new indexes
-- This is much faster than EXISTS subquery
CREATE POLICY "Users can view messages in own projects" ON chat_messages FOR SELECT 
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages in own projects" ON chat_messages FOR INSERT 
  WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

-- Analyze tables to update query planner statistics
ANALYZE projects;
ANALYZE chat_messages;

