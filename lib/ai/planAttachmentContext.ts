import type { SupabaseClient } from "@supabase/supabase-js";
import { extractFileContent } from "@/lib/ai/extractFileContent";

export interface ChatAttachmentRow {
  id: string;
  file_name: string;
  mime_type: string;
  extracted_text: string | null;
  vision_summary: string | null;
  parse_status: string;
}

function needsAnalysis(row: ChatAttachmentRow): boolean {
  if (row.parse_status === "error") return false;
  return !(row.extracted_text || row.vision_summary);
}

/**
 * Download and analyze attachments when the user sends a message (not at upload time).
 * Results are cached on the row for follow-up messages in the same project.
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
      "id, file_name, mime_type, storage_path, extracted_text, vision_summary, parse_status",
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
  attachmentIds?: string[],
): Promise<string> {
  let query = supabase
    .from("chat_attachments")
    .select("id, file_name, mime_type, extracted_text, vision_summary, parse_status")
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
  const withContent = rows.filter((r) => r.extracted_text || r.vision_summary);
  if (withContent.length === 0) return "";

  const blocks = withContent.map((row) => {
    const parts = [`### File: ${row.file_name} (${row.mime_type})`];
    if (row.vision_summary) parts.push(`Image/site summary:\n${row.vision_summary}`);
    if (row.extracted_text) parts.push(`Extracted text:\n${row.extracted_text}`);
    return parts.join("\n\n");
  });

  const heading =
    attachmentIds && attachmentIds.length > 0
      ? "## Files attached to this message"
      : "## Uploaded files for this project";

  return `${heading}\n\n${blocks.join("\n\n---\n\n")}`;
}
