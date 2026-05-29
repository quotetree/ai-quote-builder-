import type { SupabaseClient } from "@supabase/supabase-js";
import { isPdfMime } from "@/lib/ai/documentProcessingConfig";

export async function getReadyPdfDocumentsForProject(
  supabase: SupabaseClient,
  projectId: string,
  limit = 8,
): Promise<{ documentIds: string[]; fileNamesByDocId: Record<string, string> }> {
  const { data: docs } = await supabase
    .from("project_documents")
    .select("id, file_name, mime_type, file_type, processing_status")
    .eq("project_id", projectId)
    .eq("processing_status", "ready")
    .order("created_at", { ascending: false })
    .limit(40);

  const ready = (docs ?? []).filter((d) =>
    isPdfMime((d.mime_type as string) ?? (d.file_type as string), d.file_name as string),
  );

  const selected = ready.slice(0, limit);
  const fileNamesByDocId: Record<string, string> = {};
  for (const d of selected) {
    fileNamesByDocId[d.id as string] = d.file_name as string;
  }

  return {
    documentIds: selected.map((d) => d.id as string),
    fileNamesByDocId,
  };
}
