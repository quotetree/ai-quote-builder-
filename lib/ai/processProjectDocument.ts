import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentChunkDraft } from "@/lib/ai/chunkDocumentText";
import {
  MAX_PDF_PROCESSING_BYTES,
  type ProcessingProgress,
} from "@/lib/ai/documentProcessingConfig";
import { getChunkEmbeddingProvider } from "@/lib/ai/embeddings/chunkEmbeddings";
import { extractStructuredArtifacts } from "@/lib/ai/extraction/extractStructuredArtifacts";
import { runOcrOnSparsePages } from "@/lib/ai/ocr/enrichPagesWithOcr";
import { pagesToPdfPageText } from "@/lib/ai/ocr/rasterizePdfPage";
import { extractPdfPages } from "@/lib/ai/pdfPageExtractor";
import { analyzeChunkMetadata } from "@/lib/ai/rfp/chunkMetadata";
import { chunkDocumentPagesWithTables } from "@/lib/ai/rfp/tableAwareChunking";

const PROCESS_TIME_BUDGET_MS = 90_000;
const CHUNK_INSERT_BATCH = 50;

export interface ProjectDocumentProcessRow {
  id: string;
  project_id: string;
  file_name: string;
  file_type: string;
  mime_type: string | null;
  file_size: number | null;
  storage_path: string;
  processing_status: string;
  processing_progress: ProcessingProgress | null;
}

export interface ProcessDocumentResult {
  status: "ready" | "processing" | "failed";
  pageCount?: number;
  chunksWritten?: number;
  needsContinuation?: boolean;
  error?: string;
}

function syncParseStatus(processingStatus: string): string {
  switch (processingStatus) {
    case "ready":
      return "ready";
    case "processing":
      return "processing";
    case "failed":
      return "error";
    default:
      return "pending";
  }
}

async function insertChunks(
  supabase: SupabaseClient,
  documentId: string,
  projectId: string,
  drafts: DocumentChunkDraft[],
  startIndex: number,
): Promise<void> {
  const provider = getChunkEmbeddingProvider();
  const slice = drafts.slice(startIndex, startIndex + CHUNK_INSERT_BATCH);
  if (slice.length === 0) return;

  let embeddings: number[][] | null = null;
  if (provider) {
    try {
      embeddings = await provider.embed(slice.map((c) => c.chunk_text));
    } catch {
      embeddings = null;
    }
  }

  const rows = slice.map((chunk, i) => ({
    document_id: documentId,
    project_id: projectId,
    page_start: chunk.page_start,
    page_end: chunk.page_end,
    chunk_index: chunk.chunk_index,
    chunk_text: chunk.chunk_text,
    token_count: chunk.token_count,
    chunk_metadata: analyzeChunkMetadata(chunk.chunk_text),
    ...(embeddings?.[i] ? { embedding: embeddings[i] } : {}),
  }));

  const { error } = await supabase.from("document_chunks").insert(rows);
  if (error) throw new Error(error.message);
}

async function upsertNativePages(
  supabase: SupabaseClient,
  documentId: string,
  projectId: string,
  pages: { pageNumber: number; text: string }[],
): Promise<void> {
  const batchSize = 50;
  for (let i = 0; i < pages.length; i += batchSize) {
    const slice = pages.slice(i, i + batchSize);
    const rows = slice.map((p) => ({
      document_id: documentId,
      project_id: projectId,
      page_number: p.pageNumber,
      native_text: p.text || null,
      extraction_method: p.text.trim().length > 0 ? "native" : "empty",
    }));
    const { error } = await supabase
      .from("document_pages")
      .upsert(rows, { onConflict: "document_id,page_number" });
    if (error) throw new Error(error.message);
  }
}

async function loadPagesFromDb(
  supabase: SupabaseClient,
  documentId: string,
): Promise<{ page_number: number; native_text: string | null; ocr_text: string | null }[]> {
  const { data } = await supabase
    .from("document_pages")
    .select("page_number, native_text, ocr_text")
    .eq("document_id", documentId)
    .order("page_number", { ascending: true });
  return data ?? [];
}

async function runExtractionsPhase(
  supabase: SupabaseClient,
  documentId: string,
  projectId: string,
): Promise<void> {
  const { data: chunks } = await supabase
    .from("document_chunks")
    .select("id, page_start, page_end, chunk_text, chunk_metadata")
    .eq("document_id", documentId)
    .order("chunk_index", { ascending: true });

  if (!chunks?.length) return;

  await supabase.from("document_extractions").delete().eq("document_id", documentId);

  const drafts = await extractStructuredArtifacts(chunks);
  if (drafts.length === 0) return;

  const rows = drafts.map((d) => ({
    document_id: documentId,
    project_id: projectId,
    extraction_type: d.extraction_type,
    page_start: d.page_start,
    page_end: d.page_end,
    title: d.title,
    discipline: d.discipline,
    payload: d.payload,
    confidence: d.confidence,
    source_chunk_ids: d.source_chunk_ids,
  }));

  const { error } = await supabase.from("document_extractions").insert(rows);
  if (error) throw new Error(error.message);
}

/**
 * Process or resume PDF chunking for a project document.
 * Phases: pages → ocr → chunks → extractions
 */
export async function processProjectDocument(
  supabase: SupabaseClient,
  documentId: string,
  projectId: string,
): Promise<ProcessDocumentResult> {
  const now = new Date().toISOString();
  const deadline = Date.now() + PROCESS_TIME_BUDGET_MS;

  const { data: doc, error: fetchError } = await supabase
    .from("project_documents")
    .select(
      "id, project_id, file_name, file_type, mime_type, file_size, storage_path, processing_status, processing_progress",
    )
    .eq("id", documentId)
    .eq("project_id", projectId)
    .single();

  if (fetchError || !doc) {
    return { status: "failed", error: fetchError?.message ?? "Document not found" };
  }

  const row = doc as ProjectDocumentProcessRow;

  if (row.processing_status === "ready") {
    return { status: "ready" };
  }

  if ((row.file_size ?? 0) > MAX_PDF_PROCESSING_BYTES) {
    const msg = "File exceeds 150MB processing limit";
    await supabase
      .from("project_documents")
      .update({
        processing_status: "failed",
        parse_status: "error",
        parse_error: msg,
        updated_at: now,
      })
      .eq("id", documentId);
    return { status: "failed", error: msg };
  }

  await supabase
    .from("project_documents")
    .update({
      processing_status: "processing",
      parse_status: "processing",
      parse_error: null,
      updated_at: now,
    })
    .eq("id", documentId)
    .eq("project_id", projectId);

  try {
    const progress: ProcessingProgress = row.processing_progress ?? {};
    let phase = progress.phase ?? "pages";

    const { data: blob, error: downloadError } = await supabase.storage
      .from("project-files")
      .download(row.storage_path);

    if (downloadError || !blob) {
      throw new Error(downloadError?.message ?? "Could not download file");
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    let pageCount = progress.pageCount ?? 0;

    if (phase === "pages") {
      await supabase.from("document_pages").delete().eq("document_id", documentId);
      await supabase.from("document_chunks").delete().eq("document_id", documentId);
      await supabase.from("document_extractions").delete().eq("document_id", documentId);

      const extracted = await extractPdfPages(buffer);
      pageCount = extracted.pageCount;
      await upsertNativePages(supabase, documentId, projectId, extracted.pages);

      phase = "ocr";
      await supabase
        .from("project_documents")
        .update({
          processing_progress: {
            phase: "ocr",
            pageCount,
            pagesWritten: pageCount,
            ocrCompletedUpTo: 0,
            chunksInserted: 0,
          },
          page_count: pageCount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
    }

    if (phase === "ocr") {
      const ocrStart = progress.ocrCompletedUpTo ?? 0;
      const { ocrCompletedUpTo } = await runOcrOnSparsePages(
        supabase,
        documentId,
        projectId,
        buffer,
        pageCount,
        ocrStart,
        deadline,
      );

      if (ocrCompletedUpTo < pageCount && Date.now() >= deadline) {
        await supabase
          .from("project_documents")
          .update({
            processing_progress: {
              phase: "ocr",
              pageCount,
              ocrCompletedUpTo,
              chunksInserted: 0,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", documentId);
        return { status: "processing", pageCount, needsContinuation: true };
      }

      phase = "chunks";
      await supabase
        .from("project_documents")
        .update({
          processing_progress: {
            phase: "chunks",
            pageCount,
            ocrCompletedUpTo: pageCount,
            chunksInserted: progress.chunksInserted ?? 0,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
    }

    let chunkCursor = progress.chunksInserted ?? 0;

    if (phase === "chunks") {
      const pageRows = await loadPagesFromDb(supabase, documentId);
      const pages = pagesToPdfPageText(pageRows);
      const allChunks = chunkDocumentPagesWithTables(pages);

      if (allChunks.length === 0) {
        throw new Error("No text could be extracted from this PDF.");
      }

      while (chunkCursor < allChunks.length && Date.now() < deadline) {
        await insertChunks(supabase, documentId, projectId, allChunks, chunkCursor);
        chunkCursor += CHUNK_INSERT_BATCH;
      }

      if (chunkCursor < allChunks.length) {
        await supabase
          .from("project_documents")
          .update({
            processing_progress: {
              phase: "chunks",
              pageCount,
              ocrCompletedUpTo: pageCount,
              chunksInserted: chunkCursor,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", documentId);
        return {
          status: "processing",
          pageCount,
          chunksWritten: chunkCursor,
          needsContinuation: true,
        };
      }

      const searchPreview = allChunks
        .slice(0, 20)
        .map((c) => c.chunk_text)
        .join("\n")
        .slice(0, 150_000);

      const combinedText = allChunks.map((c) => c.chunk_text).join("\n").slice(0, 120_000);

      await supabase
        .from("project_documents")
        .update({
          processing_progress: {
            phase: "extractions",
            pageCount,
            chunksInserted: allChunks.length,
            extractionsComplete: false,
          },
          search_text: `${row.file_name}\n\n${searchPreview}`,
          extracted_text: combinedText,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);

      phase = "extractions";
    }

    if (phase === "extractions" && !progress.extractionsComplete) {
      if (Date.now() < deadline) {
        await runExtractionsPhase(supabase, documentId, projectId);
      } else {
        await supabase
          .from("project_documents")
          .update({
            processing_progress: {
              phase: "extractions",
              pageCount,
              chunksInserted: chunkCursor,
              extractionsComplete: false,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", documentId);
        return { status: "processing", pageCount, needsContinuation: true };
      }
    }

    await supabase
      .from("project_documents")
      .update({
        processing_status: "ready",
        parse_status: "ready",
        upload_status: "uploaded",
        page_count: pageCount,
        processing_progress: {
          phase: "extractions",
          pageCount,
          chunksInserted: chunkCursor,
          extractionsComplete: true,
        },
        indexed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        parse_error: null,
      })
      .eq("id", documentId)
      .eq("project_id", projectId);

    await supabase
      .from("chat_attachments")
      .update({
        parse_status: "ready",
        parse_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("project_document_id", documentId);

    return {
      status: "ready",
      pageCount,
      chunksWritten: chunkCursor,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed";

    await supabase
      .from("project_documents")
      .update({
        processing_status: "failed",
        parse_status: syncParseStatus("failed"),
        parse_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("project_id", projectId);

    await supabase
      .from("chat_attachments")
      .update({
        parse_status: "error",
        parse_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("project_document_id", documentId);

    return { status: "failed", error: message };
  }
}
