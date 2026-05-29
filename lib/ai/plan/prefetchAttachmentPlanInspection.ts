import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectPlanPage } from "@/lib/ai/plan/inspectPlanPage";

const DEFAULT_FOCUS =
  "LOW VOLTAGE SCHEDULE, device schedule, and keynotes: identify camera manufacturer/brand, each camera model or type, individual quantities, and total camera device count.";

/**
 * Vision-read attached plan PDFs before the Copilot LLM turn (camera/schedule questions).
 */
export async function prefetchAttachmentPlanInspection(
  supabase: SupabaseClient,
  projectId: string,
  attachmentIds: string[],
  focus: string = DEFAULT_FOCUS,
): Promise<string> {
  if (!process.env.OPENAI_API_KEY || attachmentIds.length === 0) return "";

  const { data: rows } = await supabase
    .from("chat_attachments")
    .select("id, file_name, project_document_id")
    .eq("project_id", projectId)
    .in("id", attachmentIds);

  const blocks: string[] = [];

  for (const row of rows ?? []) {
    const docId = row.project_document_id as string | null;
    if (!docId) continue;

    const { data: sheets } = await supabase
      .from("document_sheet_index")
      .select("sheet_number, page_number, trade, discipline")
      .eq("document_id", docId)
      .order("page_number", { ascending: true })
      .limit(8);

    const preferred =
      sheets?.find((s) => /low\s*voltage|lv|security|cctv/i.test(s.sheet_number ?? "")) ??
      sheets?.[0];

    const pageNumber = preferred?.page_number ?? 1;
    const result = await inspectPlanPage(supabase, projectId, {
      documentId: docId,
      pageNumber,
      sheetNumber: preferred?.sheet_number ?? undefined,
      focus,
    });

    if (result.success && result.summary.trim()) {
      const sheetLabel = result.sheetNumber ? ` (${result.sheetNumber})` : "";
      blocks.push(
        [
          `### ${row.file_name}${sheetLabel} — page ${result.pageNumber}`,
          result.summary,
        ].join("\n\n"),
      );
    }
  }

  if (blocks.length === 0) return "";

  return [
    "--- ATTACHED PLAN SHEET INSPECTION (pre-loaded) ---",
    "Use this visual analysis together with attachment excerpts below. Cite file name and page in your answer.",
    "",
    blocks.join("\n\n---\n\n"),
  ].join("\n");
}
