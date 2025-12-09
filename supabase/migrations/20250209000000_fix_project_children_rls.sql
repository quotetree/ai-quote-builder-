-- Fix RLS policies on project-related tables (chat_messages, project_documents, project_folders, project_notes)
-- Make them org-centric so all org members can access them

-- ============================================
-- CHAT MESSAGES
-- ============================================

-- Drop old user-centric policies
DROP POLICY IF EXISTS "Users can view messages in own projects" ON chat_messages;
DROP POLICY IF EXISTS "Users can insert messages in own projects" ON chat_messages;

-- Create new org-centric policies
-- All org members can view messages in org projects
CREATE POLICY "Org members can view project messages"
  ON chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = chat_messages.project_id
        AND om.user_id = auth.uid()
    )
  );

-- All org members can insert messages in org projects
CREATE POLICY "Org members can insert project messages"
  ON chat_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = chat_messages.project_id
        AND om.user_id = auth.uid()
    )
  );

-- Keep the shared project policy for external sharing
-- (already exists: "Org members can manage shared project messages")

-- ============================================
-- PROJECT DOCUMENTS
-- ============================================

-- Drop old user-centric policies
DROP POLICY IF EXISTS "Users can view docs in own projects" ON project_documents;
DROP POLICY IF EXISTS "Users can insert docs in own projects" ON project_documents;
DROP POLICY IF EXISTS "Users can update docs in own projects" ON project_documents;
DROP POLICY IF EXISTS "Users can delete docs in own projects" ON project_documents;

-- Create new org-centric policies
CREATE POLICY "Org members can view project documents"
  ON project_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_documents.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can insert project documents"
  ON project_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_documents.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can update project documents"
  ON project_documents FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_documents.project_id
        AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_documents.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can delete project documents"
  ON project_documents FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_documents.project_id
        AND om.user_id = auth.uid()
    )
  );

-- Keep the shared project policy for external sharing
-- (already exists: "Org members can manage shared project documents")

-- ============================================
-- PROJECT FOLDERS
-- ============================================

-- Drop old user-centric policies
DROP POLICY IF EXISTS "Users can view own folders" ON project_folders;
DROP POLICY IF EXISTS "Users can insert own folders" ON project_folders;
DROP POLICY IF EXISTS "Users can update own folders" ON project_folders;
DROP POLICY IF EXISTS "Users can delete own folders" ON project_folders;

-- Create new org-centric policies
CREATE POLICY "Org members can view project folders"
  ON project_folders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_folders.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can insert project folders"
  ON project_folders FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_folders.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can update project folders"
  ON project_folders FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_folders.project_id
        AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_folders.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can delete project folders"
  ON project_folders FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_folders.project_id
        AND om.user_id = auth.uid()
    )
  );

-- Keep the shared project policy for external sharing
-- (already exists: "Org members can manage shared project folders")

-- ============================================
-- PROJECT NOTES
-- ============================================

-- Drop old user-centric policies
DROP POLICY IF EXISTS "Users can view own notes" ON project_notes;
DROP POLICY IF EXISTS "Users can insert own notes" ON project_notes;
DROP POLICY IF EXISTS "Users can update own notes" ON project_notes;
DROP POLICY IF EXISTS "Users can delete own notes" ON project_notes;

-- Create new org-centric policies
CREATE POLICY "Org members can view project notes"
  ON project_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_notes.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can insert project notes"
  ON project_notes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_notes.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can update project notes"
  ON project_notes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_notes.project_id
        AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_notes.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can delete project notes"
  ON project_notes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_notes.project_id
        AND om.user_id = auth.uid()
    )
  );

-- Keep the shared project policy for external sharing
-- (already exists: "Org members can manage shared project notes")

-- ============================================
-- SUMMARY
-- ============================================
-- Now all org members can:
-- - View/insert messages in any org project
-- - View/insert/update/delete documents in any org project
-- - View/insert/update/delete folders in any org project
-- - View/insert/update/delete notes in any org project
--
-- The share_token policies remain for external sharing.

