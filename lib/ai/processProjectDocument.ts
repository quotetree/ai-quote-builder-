import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentChunkDraft } from "@/lib/ai/chunkDocumentText";
import { getChunkEmbeddingProvider } from "@/lib/ai/embeddings/chunkEmbeddings";
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
  storage_path: string;
  processing_status: string;
  processing_progress: { chunksInserted?: number; pageCount?: number } | null;
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

/**
 * Process or resume PDF chunking for a project document.
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
      "id, project_id, file_name, file_type, mime_type, storage_path, processing_status, processing_progress",
    )
    .eq("id", documentId)
    .eq("project_id", projectId)
    .single();

  if (fetchError || !doc) {
    return { status: "failed", error: fetchError?.message ?? "Document not found" };
  }

  const row = doc as ProjectDocumentProcessRow;
  const mime = row.mime_type ?? row.file_type;

  if (row.processing_status === "ready") {
    return { status: "ready" };
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
    const progress = row.processing_progress ?? {};
    let chunkCursor = progress.chunksInserted ?? 0;

    const { data: blob, error: downloadError } = await supabase.storage
      .from("project-files")
      .download(row.storage_path);

    if (downloadError || !blob) {
      throw new Error(downloadError?.message ?? "Could not download file");
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const { pageCount, pages } = await extractPdfPages(buffer);

    if (chunkCursor === 0) {
      await supabase.from("document_chunks").delete().eq("document_id", documentId);
    }

    const allChunks = chunkDocumentPagesWithTables(pages);

    if (allChunks.length === 0) {
      throw new Error("No text could be extracted from this PDF.");
    }

    while (chunkCursor < allChunks.length && Date.now() < deadline) {
      await insertChunks(supabase, documentId, projectId, allChunks, chunkCursor);
      chunkCursor += CHUNK_INSERT_BATCH;
    }

    const extractionComplete = chunkCursor >= allChunks.length;

    if (!extractionComplete) {
      await supabase
        .from("project_documents")
        .update({
          processing_progress: { chunksInserted: chunkCursor, pageCount },
          page_count: pageCount,
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

    await supabase
      .from("project_documents")
      .update({
        processing_status: "ready",
        parse_status: "ready",
        upload_status: "uploaded",
        page_count: pageCount,
        processing_progress: { chunksInserted: allChunks.length, pageCount },
        search_text: `${row.file_name}\n\n${searchPreview}`,
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
      chunksWritten: allChunks.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed";
    const failedStatus = "failed";

    await supabase
      .from("project_documents")
      .update({
        processing_status: failedStatus,
        parse_status: syncParseStatus(failedStatus),
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
