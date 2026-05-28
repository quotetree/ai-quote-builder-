import type { SupabaseClient } from "@supabase/supabase-js";
import { isPdfMime } from "@/lib/ai/documentProcessingConfig";
import { triggerDocumentProcessing } from "@/lib/ai/triggerDocumentProcessing";

export interface EnqueueResult {
  enqueued: number;
  skipped: number;
}

/** Legacy Drive PDFs indexed via pdf-parse have no chunks — re-queue them. */
async function resetLegacyPdfsWithoutChunks(
  supabase: SupabaseClient,
  projectId: string,
): Promise<void> {
  const { data: pdfs } = await supabase
    .from("project_documents")
    .select("id, file_name, file_type, mime_type, processing_status")
    .eq("project_id", projectId)
    .in("processing_status", ["ready", "pending"]);

  for (const row of pdfs ?? []) {
    const mime = row.mime_type ?? row.file_type;
    if (!isPdfMime(mime, row.file_name)) continue;

    const { count } = await supabase
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", row.id);

    if ((count ?? 0) > 0) continue;

    await supabase
      .from("project_documents")
      .update({
        processing_status: "pending",
        parse_status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("project_id", projectId);
  }
}

/**
 * Mark PDF documents as pending and schedule background processing.
 */
export async function enqueuePdfDocuments(
  supabase: SupabaseClient,
  projectId: string,
  options?: { documentIds?: string[]; maxDocs?: number },
): Promise<EnqueueResult> {
  const maxDocs = options?.maxDocs ?? 12;

  await resetLegacyPdfsWithoutChunks(supabase, projectId);

  let query = supabase
    .from("project_documents")
    .select("id, file_name, file_type, mime_type, processing_status")
    .eq("project_id", projectId)
    .in("processing_status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(maxDocs * 3);

  if (options?.documentIds?.length) {
    query = query.in("id", options.documentIds);
  }

  const { data: rows } = await query;
  if (!rows?.length) return { enqueued: 0, skipped: 0 };

  let enqueued = 0;
  let skipped = 0;

  for (const row of rows) {
    if (enqueued >= maxDocs) break;
    const mime = row.mime_type ?? row.file_type;
    if (!isPdfMime(mime, row.file_name)) {
      skipped += 1;
      continue;
    }

    await supabase
      .from("project_documents")
      .update({
        processing_status: "pending",
        parse_status: "pending",
        parse_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("project_id", projectId);

    void triggerDocumentProcessing(row.id, projectId).catch((err) => {
      console.error(`[enqueue-doc] failed doc=${row.id}`, err);
    });
    enqueued += 1;
  }

  return { enqueued, skipped };
}

export async function getPdfProcessingStatus(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ pending: number; processing: number; ready: number; failed: number }> {
  const { data } = await supabase
    .from("project_documents")
    .select("processing_status, file_type, mime_type, file_name")
    .eq("project_id", projectId);

  let pending = 0;
  let processing = 0;
  let ready = 0;
  let failed = 0;

  for (const row of data ?? []) {
    const mime = row.mime_type ?? row.file_type;
    if (!isPdfMime(mime, row.file_name)) continue;
    switch (row.processing_status) {
      case "processing":
        processing += 1;
        break;
      case "ready":
        ready += 1;
        break;
      case "failed":
        failed += 1;
        break;
      default:
        pending += 1;
    }
  }

  return { pending, processing, ready, failed };
}
