# Large PDF uploads — Plan Assistant

## Supabase Storage

Raise the **`project-files`** bucket per-object size limit to **at least 150 MB** in the Supabase dashboard (Project → Storage → `project-files` → Settings). The default is often 50 MB and will block large RFP uploads even when the app allows them.

## Processing

- PDFs upload **directly from the browser** to Supabase Storage (bypasses Next.js body limits).
- Text extraction and chunking run in `POST /api/ai/documents/process` (up to 300s per invocation, resumable via continuations).
- Vercel **Pro** is recommended for 70–200+ page documents.

## Optional embeddings

Set `ENABLE_CHUNK_EMBEDDINGS=true` and `OPENAI_API_KEY` to enable vector embeddings on chunks. Default retrieval is keyword-based.

## Test checklist

1. Image/CSV under 20 MB — legacy attach path still works.
2. PDF under 150 MB — Uploading → Processing → Ready; chat cites page numbers.
3. Unsupported type (e.g. `.docx`) — clear error before upload.
4. Failed processing — Retry on attachment chip.
5. Send disabled until all attachments show **Ready**.
