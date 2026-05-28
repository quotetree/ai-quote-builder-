-- Phase 2: plan page images, title blocks, sheet index

ALTER TABLE document_pages
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS width_px INT,
  ADD COLUMN IF NOT EXISTS height_px INT,
  ADD COLUMN IF NOT EXISTS sheet_number TEXT,
  ADD COLUMN IF NOT EXISTS sheet_title TEXT,
  ADD COLUMN IF NOT EXISTS discipline TEXT,
  ADD COLUMN IF NOT EXISTS trade TEXT,
  ADD COLUMN IF NOT EXISTS revision TEXT,
  ADD COLUMN IF NOT EXISTS title_block_confidence REAL,
  ADD COLUMN IF NOT EXISTS title_block_bbox JSONB;

CREATE TABLE IF NOT EXISTS document_sheet_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_number TEXT NOT NULL,
  sheet_title TEXT,
  discipline TEXT,
  trade TEXT,
  page_number INT NOT NULL,
  revision TEXT,
  confidence REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, sheet_number)
);

CREATE INDEX IF NOT EXISTS document_sheet_index_project_trade_idx
  ON document_sheet_index(project_id, trade);
CREATE INDEX IF NOT EXISTS document_sheet_index_document_id_idx
  ON document_sheet_index(document_id);

ALTER TABLE document_sheet_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view document sheet index"
  ON document_sheet_index FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_sheet_index.project_id AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can insert document sheet index"
  ON document_sheet_index FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_sheet_index.project_id AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can update document sheet index"
  ON document_sheet_index FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_sheet_index.project_id AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can delete document sheet index"
  ON document_sheet_index FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_sheet_index.project_id AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can update document pages sheet fields"
  ON document_pages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_pages.project_id AND om.user_id = auth.uid()
    )
  );
