import type { SupabaseClient } from "@supabase/supabase-js";
import { extractFileContent } from "@/lib/ai/extractFileContent";
import type { DocumentCitation } from "@/lib/ai/retrieveDocumentChunks";
import { retrieveRfpIntelligence } from "@/lib/ai/rfp/rfpIntelligenceRetrieval";
import { loadStructuredExtractions } from "@/lib/ai/loadStructuredExtractions";
import { loadSheetIndexContext } from "@/lib/ai/plan/loadSheetIndexContext";
import type { RfpIntent } from "@/lib/ai/rfp/rfpIntentClassifier";

export interface ChatAttachmentRow {
  id: string;
  file_name: string;
  mime_type: string;
  extracted_text: string | null;
  vision_summary: string | null;
  parse_status: string;
  project_document_id: string | null;
}

export interface PlanAttachmentContextResult {
  promptText: string;
  documentCitations: DocumentCitation[];
  isRfpAnalysisMode: boolean;
  rfpIntents: RfpIntent[];
}

function needsAnalysis(row: ChatAttachmentRow): boolean {
  if (row.project_document_id) return false;
  if (row.parse_status === "error") return false;
  return !(row.extracted_text || row.vision_summary);
}

export async function checkAttachmentsReady(
  supabase: SupabaseClient,
  projectId: string,
  attachmentIds: string[],
): Promise<{ ready: boolean; error?: string }> {
  if (attachmentIds.length === 0) return { ready: true };

  const { data: rows, error } = await supabase
    .from("chat_attachments")
    .select("id, file_name, parse_status, project_document_id")
    .eq("project_id", projectId)
    .in("id", attachmentIds);

  if (error || !rows?.length) {
    return { ready: false, error: "Could not load attachments" };
  }

  const docIds = rows
    .map((r) => r.project_document_id)
    .filter((id): id is string => Boolean(id));

  if (docIds.length > 0) {
    const { data: docs } = await supabase
      .from("project_documents")
      .select("id, file_name, processing_status, parse_error")
      .eq("project_id", projectId)
      .in("id", docIds);

    for (const doc of docs ?? []) {
      if (doc.processing_status === "pending" || doc.processing_status === "processing") {
        return {
          ready: false,
          error: `${doc.file_name} is still processing. Wait until it is ready before sending.`,
        };
      }
      if (doc.processing_status === "failed") {
        return {
          ready: false,
          error:
            doc.parse_error ??
            `${doc.file_name} failed to process. Remove it or tap Retry on the attachment.`,
        };
      }
    }
  }

  for (const row of rows) {
    if (!row.project_document_id && row.parse_status !== "ready") {
      if (row.parse_status === "error") {
        return {
          ready: false,
          error: `${row.file_name} could not be analyzed.`,
        };
      }
    }
  }

  return { ready: true };
}

/**
 * Download and analyze legacy attachments (images, CSV) when the user sends a message.
 */
export async function ensureAttachmentsAnalyzed(
  supabase: SupabaseClient,
  projectId: string,
  attachmentIds: string[],
): Promise<void> {
  if (attachmentIds.length === 0) return;

  const { data: rows, error } = await supabase
    .from("chat_attachments")
    .select(
      "id, file_name, mime_type, storage_path, extracted_text, vision_summary, parse_status, project_document_id",
    )
    .eq("project_id", projectId)
    .in("id", attachmentIds);

  if (error || !rows?.length) return;

  for (const row of rows as (ChatAttachmentRow & { storage_path: string })[]) {
    if (!needsAnalysis(row)) continue;

    await supabase
      .from("chat_attachments")
      .update({ parse_status: "processing", updated_at: new Date().toISOString() })
      .eq("id", row.id);

    const { data: blob, error: downloadError } = await supabase.storage
      .from("project-files")
      .download(row.storage_path);

    if (downloadError || !blob) {
      await supabase
        .from("chat_attachments")
        .update({
          parse_status: "error",
          parse_error: downloadError?.message ?? "Could not download file",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      continue;
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const extracted = await extractFileContent(buffer, row.mime_type, row.file_name);

    await supabase
      .from("chat_attachments")
      .update({
        extracted_text: extracted.extractedText,
        vision_summary: extracted.visionSummary,
        parse_status: extracted.parseStatus,
        parse_error: extracted.parseError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }
}

export async function loadPlanAttachmentContext(
  supabase: SupabaseClient,
  projectId: string,
  options: {
    attachmentIds?: string[];
    userMessage?: string;
  } = {},
): Promise<PlanAttachmentContextResult> {
  const { attachmentIds, userMessage = "" } = options;

  let query = supabase
    .from("chat_attachments")
    .select(
      "id, file_name, mime_type, extracted_text, vision_summary, parse_status, project_document_id",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (attachmentIds && attachmentIds.length > 0) {
    query = query.in("id", attachmentIds);
  } else {
    query = query.eq("parse_status", "ready");
  }

  const { data } = await query;
  const rows = (data ?? []) as ChatAttachmentRow[];

  const chunkedDocIds = rows
    .filter((r) => r.project_document_id)
    .map((r) => r.project_document_id as string);

  const fileNamesByDocId: Record<string, string> = {};
  for (const row of rows) {
    if (row.project_document_id) {
      fileNamesByDocId[row.project_document_id] = row.file_name;
    }
  }

  const documentCitations: DocumentCitation[] = [];
  const blocks: string[] = [];

  let isRfpAnalysisMode = false;
  let rfpIntents: RfpIntent[] = [];

  if (chunkedDocIds.length > 0) {
    const { data: docMeta } = await supabase
      .from("project_documents")
      .select("id, page_count")
      .eq("project_id", projectId)
      .in("id", chunkedDocIds);

    const pageCounts = (docMeta ?? []).map((d) => d.page_count ?? 0);

    const sheetContext = await loadSheetIndexContext(
      supabase,
      projectId,
      chunkedDocIds,
      userMessage,
    );
    if (sheetContext.promptText) blocks.push(sheetContext.promptText);

    const rfpResult = await retrieveRfpIntelligence(
      supabase,
      projectId,
      chunkedDocIds,
      userMessage,
      fileNamesByDocId,
      {
        hasChunkedPdf: true,
        pageCounts,
        preferredPagesByDocId: sheetContext.pageNumbersByDocument,
      },
    );
    isRfpAnalysisMode = rfpResult.isRfpAnalysisMode;
    rfpIntents = rfpResult.intents;
    if (rfpResult.promptText) blocks.push(rfpResult.promptText);
    documentCitations.push(...rfpResult.citations);

    if (!isRfpAnalysisMode && chunkedDocIds.length > 0) {
      const structured = await loadStructuredExtractions(
        supabase,
        projectId,
        chunkedDocIds,
        fileNamesByDocId,
        { intents: rfpIntents },
      );
      if (structured) blocks.unshift(structured);
    }
  }

  const legacyRows = rows.filter(
    (r) => !r.project_document_id && (r.extracted_text || r.vision_summary),
  );

  for (const row of legacyRows) {
    const parts = [`### File: ${row.file_name} (${row.mime_type})`];
    if (row.vision_summary) parts.push(`Image/site summary:\n${row.vision_summary}`);
    if (row.extracted_text) parts.push(`Extracted text:\n${row.extracted_text}`);
    blocks.push(parts.join("\n\n"));
  }

  if (blocks.length === 0) {
    return {
      promptText: "",
      documentCitations: [],
      isRfpAnalysisMode: false,
      rfpIntents: [],
    };
  }

  const heading =
    attachmentIds && attachmentIds.length > 0
      ? "## Files attached to this message"
      : "## Uploaded files for this project";

  const joined = blocks.join("\n\n---\n\n");
  const promptText = isRfpAnalysisMode ? joined : `${heading}\n\n${joined}`;

  return {
    promptText,
    documentCitations,
    isRfpAnalysisMode,
    rfpIntents,
  };
}
