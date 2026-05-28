# Document Intelligence Roadmap

Phased plan to evolve QuoteTree Copilot from **RFP text Q&A over chunks** to **enterprise-grade document intelligence and takeoff readiness**.

**Branch:** `plan/document-intelligence-phases`  
**Status:** Phase 1 implemented on branch `plan/document-intelligence-phases`  
**Related audit:** Document ingestion, OCR, retrieval, and AI pipeline audit (May 2026)

---

## Goals

| Phase | Outcome |
|-------|---------|
| **Phase 1** | One pipeline, OCR fallback, semantic retrieval, background indexing, structured extractions — **immediate Copilot quality lift** |
| **Phase 2** | Plan sheet intelligence — images, title blocks, sheet index, vision inspection |
| **Phase 3** | Takeoff engine — symbol/device detection, reviewable quantity extraction |

---

## Current State (Baseline)

Copilot (Plan mode) today:

- **Copilot PDFs** (`doc_source: plan_upload`) → `extractPdfPages` (pdfjs) → `chunkDocumentPagesWithTables` → `document_chunks` → keyword/RFP retrieval
- **Drive PDFs** → `pdf-parse` whole-file text → `project_documents.extracted_text` — **no chunks**
- **OCR:** None — native PDF text only; images get GPT-4o vision summaries
- **Embeddings:** Optional write to `document_chunks.embedding`; **never queried**
- **Drive indexing:** Runs **inline** on Copilot send via `ensureProjectDriveIndexed` (blocks chat)
- **Extraction:** LLM interprets raw chunk text — no structured schedule/quantity/spec records

Key files today:

| Concern | Path |
|---------|------|
| PDF processing | `lib/ai/processProjectDocument.ts` |
| Drive indexing | `lib/ai/projectDriveContext.ts` |
| Chunk retrieval | `lib/ai/retrieveDocumentChunks.ts`, `lib/ai/rfp/rfpIntelligenceRetrieval.ts` |
| Copilot API | `app/api/ai/plan/route.ts` |
| Context assembly | `lib/ai/buildFullProjectContext.ts` |
| Schema | `supabase/migrations/20260527100000_document_chunks_and_processing.sql` |

---

## Architecture Target

```
                    ┌─────────────────────────────────────┐
                    │         Unified ingest trigger       │
                    │  Drive upload · Copilot attach · retry │
                    └─────────────────┬───────────────────┘
                                      │
                    ┌─────────────────▼───────────────────┐
                    │     processProjectDocument (async)   │
                    │  extract → OCR fallback → chunk → embed │
                    │  → structured extraction → sheet prep  │
                    └─────────────────┬───────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
   document_chunks            document_extractions         document_pages (P2)
   (+ embeddings)             (tables, schedules, qty)     (+ raster images)
          │                           │                           │
          └───────────────────────────┼───────────────────────────┘
                                      ▼
                    ┌─────────────────────────────────────┐
                    │   Hybrid retrieval (keyword + vector) │
                    │   + structured context for Copilot    │
                    └─────────────────────────────────────┘
```

---

# Phase 1 — Make Copilot Much Smarter

**Objective:** Single PDF pipeline, readable scanned pages, semantic search, non-blocking Drive indexing, and machine-readable extractions Copilot can cite.

**Estimated effort:** 4–6 weeks  
**User-visible win:** Copilot answers improve immediately for Drive PDFs, scanned RFPs, and schedule/quantity questions.

---

## 1.1 Unify all PDFs into one processing pipeline

### Problem

Drive PDFs and Copilot PDFs follow different paths. Drive files never populate `document_chunks`, so RFP retrieval and page citations do not apply.

### Work

1. **Route all analyzable PDFs through `processProjectDocument`**
   - On Drive upload completion (`DrivePanel.handleFileUpload`) and on existing pending rows, enqueue processing instead of `indexOneDocument` → `extractFileContent` → `pdf-parse`.
   - Keep `doc_source` (`drive` | `plan_upload`) for UI filtering; processing logic is identical.

2. **Deprecate whole-file PDF path for retrieval**
   - `loadProjectDriveContext` should prefer `document_chunks` when `processing_status = ready`.
   - Fall back to `extracted_text` only for legacy rows until backfill completes.

3. **Backfill job**
   - Script or admin API: find `project_documents` where `mime_type = application/pdf`, `processing_status != ready`, enqueue `triggerDocumentProcessing`.
   - Raise Drive indexing limit from 25 MB to align with Plan PDF limit (150 MB) or a shared constant.

4. **Single entry point**
   - New `enqueueDocumentProcessing(documentId, projectId)` called from:
     - `app/api/ai/documents/register/route.ts` (existing)
     - Drive upload handler
     - `POST /api/ai/documents/process` (retry)
     - Background sweep for stale `pending` rows

### Acceptance criteria

- [ ] Every PDF in a project ends up in `document_chunks` with page ranges
- [ ] Drive PDFs get page citations in Copilot responses
- [ ] RFP multi-pass retrieval works for Drive-uploaded RFPs without re-uploading

### Files to touch

- `lib/ai/projectDriveContext.ts` — remove inline `pdf-parse` for PDFs; trigger processing
- `components/DrivePanel.tsx` — call register/process after upload
- `lib/ai/buildFullProjectContext.ts` — Drive context reads chunks when available
- `lib/ai/triggerDocumentProcessing.ts` — shared enqueue helper

---

## 1.2 True OCR fallback for scanned/empty pages

### Problem

`extractPdfPages` uses pdfjs text layer only. Scanned drawings and image-only PDFs produce empty chunks.

### Work

1. **Page-level sparse detection**
   - After native extraction, flag pages where `text.length < MIN_NATIVE_TEXT_CHARS` (e.g. 50) as `needs_ocr`.

2. **OCR provider (choose one for v1)**
   - **Recommended:** AWS Textract `DetectDocumentText` per page (good table OCR, pay-per-page)
   - **Alternative:** Google Document AI or Azure Read — same interface behind `OcrProvider` abstraction
   - **Not recommended for plans:** Tesseract self-hosted (weak on drawings, ops burden)

3. **Implementation**
   - `lib/ai/ocr/ocrProvider.ts` — interface + Textract adapter
   - `lib/ai/ocr/rasterizePdfPage.ts` — pdfjs render page → PNG buffer (reuse pattern from proposal modal, server-side)
   - In `processProjectDocument`: for each `needs_ocr` page, rasterize → OCR → merge text with source tag `[OCR]`
   - Store per-page metadata: `{ extraction_method: "native" | "ocr" | "hybrid", ocr_confidence?: number }` on chunk or new `document_pages` stub column

4. **Cost controls**
   - Env: `OCR_ENABLED=true`, `OCR_MAX_PAGES_PER_DOC` (default 200), `OCR_PROVIDER=textract`
   - Skip OCR for pages that already have sufficient native text
   - Log page count and OCR spend per document

5. **Failure mode**
   - OCR failure → keep native (empty) text; set `processing_status = ready` with warning in `parse_error` if all pages empty

### Acceptance criteria

- [ ] Scanned RFP PDF (no text layer) produces searchable chunks with page citations
- [ ] Native-text pages are not sent to OCR
- [ ] Processing remains resumable (OCR pages tracked in `processing_progress`)

### New env vars

| Variable | Purpose |
|----------|---------|
| `OCR_ENABLED` | Gate OCR fallback |
| `OCR_PROVIDER` | `textract` (default) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | Textract |
| `OCR_MAX_PAGES_PER_DOC` | Cost cap |

---

## 1.3 Wire pgvector semantic retrieval

### Problem

`ENABLE_CHUNK_EMBEDDINGS=true` writes vectors that are never queried. Retrieval is keyword-only and loads all chunks into memory.

### Work

1. **Database**
   - Migration: HNSW index on `document_chunks.embedding` (cosine or inner product)
   - RPC: `match_document_chunks(query_embedding, document_ids[], match_count, match_threshold)`

2. **Query-time embedding**
   - `lib/ai/embeddings/embedQuery.ts` — embed user message with `text-embedding-3-small`
   - Cache query embedding per request (one embed per Copilot message)

3. **Hybrid scoring**
   - New `lib/ai/retrieval/hybridRetrieval.ts`:
     - `semanticScore` from pgvector RPC (top 50 candidates)
     - `keywordScore` from existing term overlap
     - `metadataBoost` from existing `chunk_metadata` / RFP intents
     - `finalScore = w1*semantic + w2*keyword + w3*metadata` (tune weights; default 0.5/0.3/0.2)
   - Replace full-table load in `retrieveDocumentChunks` and `retrieveRfpIntelligence` with hybrid path when embeddings exist

4. **Fallback**
   - If embeddings disabled or chunk has null embedding → keyword-only (current behavior)
   - Backfill embeddings: `POST /api/ai/documents/process` re-runs embed step for existing chunks

5. **Performance**
   - Limit RPC to `document_ids` from current attachments + top-N Drive docs by relevance
   - Stop loading all chunks for 500+ page docs

### Acceptance criteria

- [ ] Paraphrased questions retrieve relevant chunks missed by keyword-only
- [ ] RFP mode uses hybrid retrieval without regression on exact-term queries
- [ ] p95 retrieval latency < 500ms for 200-page doc (with index)

### New env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `ENABLE_CHUNK_EMBEDDINGS` | `false` | Must be `true` for semantic path |
| `HYBRID_SEMANTIC_WEIGHT` | `0.5` | Tuning |
| `HYBRID_KEYWORD_WEIGHT` | `0.3` | Tuning |
| `SEMANTIC_MATCH_COUNT` | `50` | RPC candidate pool |

---

## 1.4 Move Drive indexing fully into background jobs

### Problem

`buildFullProjectContext` calls `ensureProjectDriveIndexed` with `indexMaxDocs: 8` **on every Copilot send**, blocking the user.

### Work

1. **Enqueue on upload, not on chat**
   - Drive upload → `enqueueDocumentProcessing` (same as 1.1)
   - Remove synchronous indexing from `app/api/ai/plan/route.ts`

2. **Background sweep**
   - `POST /api/ai/documents/sweep` (cron or Vercel cron): process pending Drive PDFs across projects
   - Reuse `after()` pattern from `app/api/ai/context/route.ts` for fire-and-forget, but prefer durable queue (see below)

3. **Copilot behavior when docs still processing**
   - `loadProjectDriveContext` returns catalog + "N files still processing" note
   - Do not block send; use whatever chunks are ready
   - UI: Drive panel shows processing badge (reuse Plan attachment polling pattern)

4. **Durable queue (recommended for Phase 1)**
   - **Option A:** Inngest / Trigger.dev — `document.process` event, retries, visibility
   - **Option B:** Supabase `pg_cron` + Edge Function calling process route
   - **Option C (minimal):** Keep `after()` + continuations but never on chat path

   Start with Option C for speed; migrate to A when OCR adds latency.

### Acceptance criteria

- [ ] Copilot first token time no longer includes Drive PDF download/parse
- [ ] Uploading a PDF to Drive eventually produces chunks without user opening Copilot
- [ ] Chat works with partial project index (graceful degradation)

### Files to touch

- `app/api/ai/plan/route.ts` — remove `indexMaxDocs: 8` blocking call
- `lib/ai/buildFullProjectContext.ts` — read-only context load
- `app/api/ai/context/route.ts` — extend background sweep

---

## 1.5 Structured extraction (tables, schedules, spec sections, quantities)

### Problem

Schedules and quantities live as plain text in chunks. Copilot re-parses every time; no validation, no estimator review surface.

### Work

1. **Schema**

```sql
-- document_extractions: one row per extracted artifact
CREATE TABLE document_extractions (
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
  payload JSONB NOT NULL,        -- type-specific structured data
  confidence REAL,             -- 0-1
  source_chunk_ids UUID[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON document_extractions(document_id, extraction_type);
CREATE INDEX ON document_extractions USING GIN (payload);
```

**Payload shapes (examples):**

```typescript
// schedule
{ columns: string[], rows: Record<string, string>[], schedule_kind: "panel" | "device" | "door" | "unknown" }

// spec_section
{ section_number: "26 05 00", title: "Common Work Results", division: "26" }

// quantity
{ item: string, qty: number, unit: string, location?: string, raw_text: string }

// entity
{ entity_type: "device" | "room" | "panel", label: string, attributes: Record<string, string> }
```

2. **Extraction pipeline (post-chunking)**
   - New step in `processProjectDocument` after chunks inserted: `extractStructuredArtifacts(documentId)`
   - **Heuristic pass:** reuse `chunk_metadata.has_table`, schedule keywords → candidate chunks
   - **LLM pass:** structured output (JSON schema) via `gpt-4o-mini` per candidate chunk or merged table span — cheaper than main Copilot model
   - **Spec sections:** regex for CSI patterns (`\d{2}\s\d{2}\s\d{2}`, `DIVISION 26`) + LLM confirmation

3. **Retrieval integration**
   - `loadStructuredExtractions(documentIds, intents)` → inject summarized JSON into Copilot context before raw chunks
   - Citations link to extraction row + page range
   - RFP intents map to extraction types (quantities → `quantity`, materials → `schedule`, scope → `spec_section`)

4. **Idempotency**
   - Delete prior extractions for document on re-process
   - Store `extraction_version` in payload for migration

### Acceptance criteria

- [ ] Panel/device schedule PDF produces queryable `schedule` rows in DB
- [ ] Copilot answers "how many cameras" using structured quantities with page cites
- [ ] Spec section questions retrieve division/section records without scanning all chunks

### Files to add

- `lib/ai/extraction/extractStructuredArtifacts.ts`
- `lib/ai/extraction/scheduleExtractor.ts`
- `lib/ai/extraction/specSectionExtractor.ts`
- `lib/ai/extraction/quantityExtractor.ts`
- `lib/ai/loadStructuredExtractions.ts`

---

## Phase 1 — Delivery Order

| Step | Item | Depends on |
|------|------|------------|
| 1 | 1.4 Background indexing (stop blocking chat) | — |
| 2 | 1.1 Unify PDF pipeline | 1.4 |
| 3 | 1.3 Hybrid retrieval | 1.1 (chunks exist for all PDFs) |
| 4 | 1.2 OCR fallback | 1.1 (same processing loop) |
| 5 | 1.5 Structured extraction | 1.1, ideally 1.2 for scanned tables |

## Phase 1 — Success Metrics

- Copilot p95 time-to-first-token drops ≥ 30% (no inline Drive indexing)
- Scanned 50-page RFP: ≥ 80% pages with non-empty chunk text
- Hybrid retrieval: ≥ 15% relative improvement on paraphrase eval set (internal benchmark)
- Structured extractions: schedule rows extracted from ≥ 70% of test panel-schedule PDFs

---

# Phase 2 — Plan Intelligence

**Objective:** Treat construction drawings as first-class objects — sheet index, title blocks, trade labels, vision inspection.

**Estimated effort:** 6–8 weeks  
**Depends on:** Phase 1 unified pipeline + OCR rasterization primitives

---

## 2.1 Render plan pages as images

### Work

1. **Schema**

```sql
CREATE TABLE document_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  storage_path TEXT,              -- project-files: .../pages/{docId}/p-{n}.webp
  width_px INT,
  height_px INT,
  extraction_method TEXT,         -- native | ocr
  native_text TEXT,
  ocr_text TEXT,
  UNIQUE (document_id, page_number)
);
```

2. **Rasterization during processing**
   - After text/OCR step, render each page to WebP (150–200 DPI for storage; 300 DPI optional for vision)
   - Store in `project-files` under `project-{id}/doc-pages/{docId}/p-{n}.webp`
   - Gate with `PLAN_PAGE_IMAGES_ENABLED=true`; skip for pure text RFPs if `page_category = text` heuristic

3. **Signed URL access for vision calls**
   - Server downloads from storage or uses pre-signed buffer — never expose raw paths to client

### Acceptance criteria

- [ ] 100-page plan set has 100 image rows linked to document
- [ ] Images generated in same background job as chunking (no chat-path work)

---

## 2.2 Detect title blocks, sheet numbers, sheet names, trade

### Work

1. **Title block detection**
   - **Heuristic v1:** bottom-right 25% crop of page image (common title block location)
   - **Vision v1:** GPT-4o on crop with JSON schema:
     ```json
     { "sheet_number": "A-101", "sheet_title": "FIRST FLOOR PLAN", "discipline": "architectural", "revision": "2", "confidence": 0.92 }
     ```
   - **OCR assist:** Textract on crop for text-only fallback

2. **Discipline / trade mapping**
   - Map sheet prefix patterns: `A-*` → architectural, `E-*` → electrical, `FA-*` → fire alarm, etc.
   - Store normalized `discipline` and `trade` (for estimating: low voltage, electrical, security)

3. **Persist on `document_pages`**
   - Columns: `sheet_number`, `sheet_title`, `discipline`, `trade`, `title_block_confidence`, `title_block_bbox` (optional)

4. **Re-run on revision**
   - Re-process document replaces page rows and sheet index

### Acceptance criteria

- [ ] ≥ 85% accuracy on sheet number extraction for standard US architectural sets (eval set)
- [ ] Copilot can answer "what sheets are electrical?" from sheet index

---

## 2.3 Build a real sheet index

### Work

1. **Schema**

```sql
CREATE TABLE document_sheet_index (
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
  UNIQUE (document_id, sheet_number)
);
CREATE INDEX ON document_sheet_index(project_id, trade);
```

2. **Project-level index view**
   - API: `GET /api/ai/documents/{id}/sheet-index`
   - UI: Sheet index panel in Drive or Copilot sidebar (filter by trade/discipline)

3. **Retrieval boost**
   - User mentions sheet number → direct page lookup before hybrid search
   - Trade-filtered retrieval: "count devices on FA sheets" → restrict to `trade = fire_alarm` pages

### Acceptance criteria

- [ ] Sheet index populated for all plan PDFs after processing
- [ ] Copilot retrieves correct page when user cites `E-401`

---

## 2.4 AI vision inspection of plan sheets

### Work

1. **Tool: `inspect_plan_page`**
   - Copilot tool accepts `{ documentId, pageNumber }` or `{ sheetNumber }`
   - Server loads WebP → GPT-4o vision with estimator-focused prompt (symbols, legends, notes, counts visible on sheet)

2. **When to invoke**
   - Auto-suggest when query mentions drawings/plans and text chunks are sparse
   - User explicit: "look at sheet A-101"

3. **Cost controls**
   - Max 3 vision calls per Copilot message
   - Prefer title-block crop + legend crop before full page

4. **Output**
   - Structured summary stored ephemerally in response; optional persist to `document_extractions` type `entity`

### Acceptance criteria

- [ ] Copilot answers legend/symbol questions on scanned plans using vision
- [ ] Vision calls never run on chat upload path — only on demand via tool

---

## Phase 2 — Success Metrics

- Sheet number extraction ≥ 85% on benchmark set
- Vision tool resolves ≥ 70% of "what does symbol X mean" test queries
- Plan PDF processing time ≤ 3 min per 50 sheets (background, p95)

---

# Phase 3 — Takeoff Engine

**Objective:** Detect symbols/devices and produce **reviewable quantity extractions** for estimators — not auto-quote without human approval.

**Estimated effort:** 8–12 weeks  
**Depends on:** Phase 2 page images, sheet index, structured extraction patterns

---

## 3.1 Detect symbols and devices

### Work

1. **Scope definition (v1)**
   - Low-voltage / security symbols: cameras, card readers, motion, door contacts, FA devices
   - Input: full-page image + sheet discipline + legend context from vision

2. **Approach tiers**
   - **Tier A (Phase 3 start):** Vision LLM count + locate approximate regions — fast, lower precision
   - **Tier B:** Specialized model (Roboflow/YOLO custom) trained on symbol libraries — higher precision, ops cost
   - Start Tier A; design `device_detections` schema for Tier B boxes

3. **Schema**

```sql
CREATE TABLE device_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  sheet_number TEXT,
  device_type TEXT NOT NULL,
  label TEXT,
  bbox JSONB,                   -- { x, y, w, h } normalized 0-1
  confidence REAL,
  detection_method TEXT,        -- vision_llm | cv_model
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'merged')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ
);
```

4. **Legend-aware detection**
   - First pass: vision extracts legend mapping symbol → device type
   - Second pass: count instances per sheet using legend

### Acceptance criteria

- [ ] System proposes device counts per sheet with bounding regions (even if approximate)
- [ ] Estimator can confirm/reject detections in UI

---

## 3.2 Extract quantities for estimator review

### Work

1. **Aggregation layer**
   - Roll up `device_detections` (confirmed) + `document_extractions` (schedules, quantities) into `takeoff_line_items`:

```sql
CREATE TABLE takeoff_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id UUID,
  source_type TEXT NOT NULL,     -- schedule | symbol_count | manual | spec
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT,
  trade TEXT,
  sheet_numbers TEXT[],
  page_refs INT[],
  confidence REAL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  linked_product_id UUID,        -- optional price book link
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

2. **Reconciliation rules**
   - Schedule qty vs symbol count vs spec qty → flag discrepancies for review
   - Never silently overwrite approved items

3. **UI: Takeoff review panel**
   - Table of proposed line items with source citations (sheet, schedule row, detection)
   - Approve → optional push to spreadsheet/quote as draft rows
   - Export CSV for estimators

4. **Copilot integration**
   - "Prepare takeoff for cameras" → populates draft `takeoff_line_items`, opens review UI
   - Copilot cites sources; human approves before quote impact

### Acceptance criteria

- [ ] End-to-end: plan PDF → draft takeoff lines → estimator approve → spreadsheet import
- [ ] Quantity disagreements between schedule and symbol count surfaced explicitly
- [ ] No auto-commit to quote without `status = approved`

---

## Phase 3 — Success Metrics

- Device count within ±10% of manual takeoff on benchmark plan set (after review)
- Estimator review time ≤ 50% of fully manual takeoff for symbol-heavy sheets
- Zero production quotes modified without explicit approval event

---

# Cross-Cutting Concerns

## Job orchestration

| Phase | Recommendation |
|-------|----------------|
| 1 | `after()` + continuations (existing); add cron sweep |
| 1.5+ | Inngest or Trigger.dev for OCR + extraction retries |
| 2–3 | Required — vision/OCR jobs exceed serverless comfortable limits |

## Cost management

- OCR per page, embed per chunk, vision per sheet — log to `document_processing_costs` table (optional)
- Per-org daily caps via env + middleware

## Security

- All storage stays in private `project-files` bucket
- Vision/OCR sends page buffers to third parties — document in privacy policy; optional org-level disable

## Testing strategy

| Layer | Approach |
|-------|----------|
| Chunking/OCR | Fixture PDFs: native text, scanned, mixed |
| Retrieval | Golden questions + expected page hits |
| Sheet index | Labeled title block eval set (20+ sheets) |
| Takeoff | Compare approved lines to manual ground truth |

## Migration / backwards compatibility

- Legacy `extracted_text` rows remain until backfill completes
- Feature flags per phase: `UNIFIED_PDF_PIPELINE`, `OCR_ENABLED`, `HYBRID_RETRIEVAL`, `STRUCTURED_EXTRACTION`, `PLAN_PAGE_IMAGES`, `TAKEOFF_ENGINE`

---

# Implementation Checklist (Summary)

## Phase 1
- [ ] 1.1 Unify PDF pipeline (Drive + Copilot → `document_chunks`)
- [ ] 1.2 OCR fallback for sparse pages
- [ ] 1.3 pgvector hybrid retrieval
- [ ] 1.4 Background Drive indexing (remove chat-path blocking)
- [ ] 1.5 Structured extraction tables + schema

## Phase 2
- [ ] 2.1 Page image rasterization + `document_pages`
- [ ] 2.2 Title block / sheet / trade detection
- [ ] 2.3 Sheet index table + API
- [ ] 2.4 Copilot `inspect_plan_page` vision tool

## Phase 3
- [ ] 3.1 Symbol/device detection + review UI
- [ ] 3.2 Takeoff line items + approval workflow + spreadsheet export

---

# Open Decisions

1. **OCR vendor:** Textract vs Document AI — decide before 1.2 based on AWS account and table accuracy samples.
2. **Job queue:** Inngest vs Trigger.dev vs pg_cron — decide before OCR lands in production.
3. **Takeoff UI surface:** New panel vs Spreadsheet tab vs Copilot sidebar — product call before Phase 3.
4. **Auto-run vision on upload:** Default off; on-demand tool only until costs validated.

---

*This document is the implementation blueprint for branch `plan/document-intelligence-phases`. Update checkboxes as work lands.*
