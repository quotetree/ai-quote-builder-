# RFP Intelligence Retrieval

Plan Assistant uses multi-pass keyword retrieval over `document_chunks` for large RFP/PWS PDFs.

## Behavior

- **Default:** 12 chunks, single pass (images, small files, simple questions).
- **RFP mode:** Up to 35 chunks across 6 thematic passes (locations, schedules, scope, quote, labor, exclusions).

RFP mode activates when a chunked PDF is attached and any of: filename matches RFP/PWS/spec/bid patterns, document has 20+ pages, or the question matches multiple RFP intents.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `RFP_MAX_CHUNKS` | `35` | Max chunks in RFP retrieval |
| `RFP_MAX_CONTEXT_TOKENS` | `32000` | Token budget for retrieved context |
| `RFP_RETRIEVAL_DEBUG` | off | Force debug logs in production |
| `ENABLE_CHUNK_EMBEDDINGS` | off | Vector embeddings at ingest + hybrid semantic retrieval |
| `HYBRID_SEMANTIC_WEIGHT` | `0.5` | Semantic score weight |
| `HYBRID_KEYWORD_WEIGHT` | `0.3` | Keyword score weight |
| `SEMANTIC_MATCH_THRESHOLD` | `0.25` | Minimum cosine similarity for pgvector RPC |

Debug logs also print automatically when `NODE_ENV=development`.

## Re-processing documents

New uploads store `chunk_metadata` and use table-aware chunking. Existing chunks get metadata computed lazily at retrieval time. To refresh chunk boundaries, re-upload or call `POST /api/ai/documents/process`.

## Migration

Apply migrations through `20260529000000_phase1_document_intelligence.sql` (includes `document_pages`, `document_extractions`, and `match_document_chunks` RPC).
