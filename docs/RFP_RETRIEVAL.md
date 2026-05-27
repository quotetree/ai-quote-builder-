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
| `ENABLE_CHUNK_EMBEDDINGS` | off | Optional vector embeddings (unchanged) |

Debug logs also print automatically when `NODE_ENV=development`.

## Re-processing documents

New uploads store `chunk_metadata` and use table-aware chunking. Existing chunks get metadata computed lazily at retrieval time. To refresh chunk boundaries, re-upload or call `POST /api/ai/documents/process`.

## Migration

Apply `supabase/migrations/20260528100000_document_chunks_metadata.sql`.
