-- Chunk metadata for RFP intelligence retrieval (table/scope/location signals)

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS chunk_metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS document_chunks_metadata_gin_idx
  ON document_chunks USING gin (chunk_metadata);
