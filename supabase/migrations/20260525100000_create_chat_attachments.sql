-- Plan mode file attachments for AI context (Phase 6)

CREATE TABLE IF NOT EXISTS chat_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  file_size BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  extracted_text TEXT,
  vision_summary TEXT,
  parse_status TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending', 'processing', 'ready', 'error')),
  parse_error TEXT,
  source TEXT NOT NULL DEFAULT 'plan_upload' CHECK (source IN ('plan_upload', 'drive_reference')),
  project_document_id UUID REFERENCES project_documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_attachments_project_id_idx ON chat_attachments(project_id);
CREATE INDEX IF NOT EXISTS chat_attachments_uploaded_by_idx ON chat_attachments(uploaded_by);

ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view chat attachments"
  ON chat_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = chat_attachments.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can insert chat attachments"
  ON chat_attachments FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = chat_attachments.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can update chat attachments"
  ON chat_attachments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = chat_attachments.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can delete chat attachments"
  ON chat_attachments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = chat_attachments.project_id
        AND om.user_id = auth.uid()
    )
  );
