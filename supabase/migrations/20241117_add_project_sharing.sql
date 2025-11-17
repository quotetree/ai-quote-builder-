-- Add share metadata to projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS share_token_created_at TIMESTAMPTZ;

-- Helper to check shared access scoped to organization
CREATE OR REPLACE FUNCTION can_access_shared_project(target_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM projects p
    JOIN profiles owner ON owner.id = p.user_id
    JOIN profiles viewer ON viewer.id = auth.uid()
    WHERE p.id = target_project_id
      AND p.share_token IS NOT NULL
      AND owner.company_name IS NOT NULL
      AND viewer.company_name IS NOT NULL
      AND owner.company_name = viewer.company_name
  );
$$;

-- Allow org members to read shared projects
CREATE POLICY "Org members can view shared projects"
  ON projects
  FOR SELECT
  USING (
    share_token IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM profiles owner
      JOIN profiles viewer ON viewer.id = auth.uid()
      WHERE owner.id = projects.user_id
        AND owner.company_name IS NOT NULL
        AND viewer.company_name IS NOT NULL
        AND owner.company_name = viewer.company_name
    )
  );

-- Shared access for project-scoped resources
CREATE POLICY "Org members can manage shared project messages"
  ON chat_messages
  FOR ALL
  USING (can_access_shared_project(project_id))
  WITH CHECK (can_access_shared_project(project_id));

CREATE POLICY "Org members can manage shared project documents"
  ON project_documents
  FOR ALL
  USING (can_access_shared_project(project_id))
  WITH CHECK (can_access_shared_project(project_id));

CREATE POLICY "Org members can manage shared project folders"
  ON project_folders
  FOR ALL
  USING (can_access_shared_project(project_id))
  WITH CHECK (can_access_shared_project(project_id));

CREATE POLICY "Org members can manage shared project notes"
  ON project_notes
  FOR ALL
  USING (can_access_shared_project(project_id))
  WITH CHECK (can_access_shared_project(project_id));

CREATE POLICY "Org members can manage shared project working state"
  ON project_working_state
  FOR ALL
  USING (can_access_shared_project(project_id))
  WITH CHECK (can_access_shared_project(project_id));

CREATE POLICY "Org members can manage shared project quotes"
  ON quotes
  FOR ALL
  USING (can_access_shared_project(project_id))
  WITH CHECK (can_access_shared_project(project_id));

CREATE POLICY "Org members can manage shared quote items"
  ON quote_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM quotes q
      WHERE q.id = quote_items.quote_id
        AND can_access_shared_project(q.project_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM quotes q
      WHERE q.id = quote_items.quote_id
        AND can_access_shared_project(q.project_id)
    )
  );


