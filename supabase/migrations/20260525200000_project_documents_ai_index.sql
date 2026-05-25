-- Cached extraction / search text for Drive files (project-scoped AI context)

ALTER TABLE project_documents
  ADD COLUMN IF NOT EXISTS extracted_text TEXT,
  ADD COLUMN IF NOT EXISTS vision_summary TEXT,
  ADD COLUMN IF NOT EXISTS search_text TEXT,
  ADD COLUMN IF NOT EXISTS parse_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'processing', 'ready', 'error', 'skipped')),
  ADD COLUMN IF NOT EXISTS parse_error TEXT,
  ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS project_documents_project_parse_idx
  ON project_documents(project_id, parse_status);

COMMENT ON COLUMN project_documents.search_text IS
  'Denormalized searchable blob: file name + extracted text + vision summary';
