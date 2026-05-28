-- Phase 1: document_pages, document_extractions, pgvector retrieval

CREATE TABLE IF NOT EXISTS document_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  native_text TEXT,
  ocr_text TEXT,
  extraction_method TEXT NOT NULL DEFAULT 'native'
    CHECK (extraction_method IN ('native', 'ocr', 'hybrid', 'empty')),
  ocr_confidence REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, page_number)
);

CREATE INDEX IF NOT EXISTS document_pages_document_id_idx ON document_pages(document_id);
CREATE INDEX IF NOT EXISTS document_pages_project_id_idx ON document_pages(project_id);

CREATE TABLE IF NOT EXISTS document_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  extraction_type TEXT NOT NULL CHECK (extraction_type IN (
    'table', 'schedule', 'spec_section', 'quantity', 'entity'
  )),
  page_start INT NOT NULL,
  page_end INT NOT NULL,
  title TEXT,
  discipline TEXT,
  payload JSONB NOT NULL,
  confidence REAL,
  source_chunk_ids UUID[],
  extraction_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_extractions_document_id_idx
  ON document_extractions(document_id, extraction_type);
CREATE INDEX IF NOT EXISTS document_extractions_project_id_idx
  ON document_extractions(project_id);
CREATE INDEX IF NOT EXISTS document_extractions_payload_gin_idx
  ON document_extractions USING GIN (payload);

ALTER TABLE document_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view document pages"
  ON document_pages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_pages.project_id AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can insert document pages"
  ON document_pages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_pages.project_id AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can update document pages"
  ON document_pages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_pages.project_id AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can delete document pages"
  ON document_pages FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_pages.project_id AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can view document extractions"
  ON document_extractions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_extractions.project_id AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can insert document extractions"
  ON document_extractions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_extractions.project_id AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can delete document extractions"
  ON document_extractions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = document_extractions.project_id AND om.user_id = auth.uid()
    )
  );

-- pgvector semantic search (partial index — only embedded rows)
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1536),
  match_project_id UUID,
  match_document_ids UUID[],
  match_count INT DEFAULT 50,
  match_threshold FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  page_start INT,
  page_end INT,
  chunk_index INT,
  chunk_text TEXT,
  token_count INT,
  chunk_metadata JSONB,
  similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    dc.id,
    dc.document_id,
    dc.page_start,
    dc.page_end,
    dc.chunk_index,
    dc.chunk_text,
    dc.token_count,
    dc.chunk_metadata,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE dc.project_id = match_project_id
    AND dc.document_id = ANY (match_document_ids)
    AND dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) >= match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;
