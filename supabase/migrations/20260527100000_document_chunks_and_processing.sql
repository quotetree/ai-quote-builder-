-- Document chunking for Plan Assistant large PDF ingestion

ALTER TABLE project_documents
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS upload_status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (upload_status IN ('uploading', 'uploaded', 'failed')),
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS page_count INT,
  ADD COLUMN IF NOT EXISTS processing_progress JSONB,
  ADD COLUMN IF NOT EXISTS doc_source TEXT NOT NULL DEFAULT 'drive'
    CHECK (doc_source IN ('drive', 'plan_upload'));

-- Backfill mime_type from file_type for existing rows
UPDATE project_documents
SET mime_type = file_type
WHERE mime_type IS NULL AND file_type IS NOT NULL;

-- Mirror legacy parse_status into processing_status where unset
UPDATE project_documents
SET processing_status = CASE parse_status
  WHEN 'ready' THEN 'ready'
  WHEN 'processing' THEN 'processing'
  WHEN 'error' THEN 'failed'
  WHEN 'skipped' THEN 'ready'
  ELSE 'pending'
END
WHERE processing_status = 'pending' AND parse_status IS NOT NULL AND parse_status != 'pending';

CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_start INT NOT NULL,
  page_end INT NOT NULL,
  chunk_index INT NOT NULL,
  chunk_text TEXT NOT NULL,
  token_count INT,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS document_chunks_project_id_idx ON document_chunks(project_id);

CREATE INDEX IF NOT EXISTS project_documents_processing_status_idx
  ON project_documents(project_id, processing_status);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view document chunks"
  ON document_chunks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_chunks.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can insert document chunks"
  ON document_chunks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_chunks.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can update document chunks"
  ON document_chunks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_chunks.project_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can delete document chunks"
  ON document_chunks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_chunks.project_id
        AND om.user_id = auth.uid()
    )
  );
