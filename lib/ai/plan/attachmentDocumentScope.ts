import type { SupabaseClient } from "@supabase/supabase-js";

export interface AttachmentDocumentScope {
  documentIds: string[];
  fileNames: string[];
  fileNamesByDocId: Record<string, string>;
}

/**
 * Resolve project_document IDs for chat attachments on the current message only.
 */
export async function resolveAttachmentDocumentScope(
  supabase: SupabaseClient,
  projectId: string,
  attachmentIds: string[],
): Promise<AttachmentDocumentScope> {
  if (attachmentIds.length === 0) {
    return { documentIds: [], fileNames: [], fileNamesByDocId: {} };
  }

  const { data: rows } = await supabase
    .from("chat_attachments")
    .select("file_name, project_document_id")
    .eq("project_id", projectId)
    .in("id", attachmentIds);

  const documentIds: string[] = [];
  const fileNames: string[] = [];
  const fileNamesByDocId: Record<string, string> = {};

  for (const row of rows ?? []) {
    fileNames.push(row.file_name);
    if (row.project_document_id) {
      documentIds.push(row.project_document_id);
      fileNamesByDocId[row.project_document_id] = row.file_name;
    }
  }

  return { documentIds, fileNames, fileNamesByDocId };
}

export function formatAttachmentOnlyDriveScope(scope: AttachmentDocumentScope): string {
  const lines = [
    "## This message — attached files only",
    "The user attached file(s) to **this** Copilot message. Answer using only the attachment section below (and any pre-loaded plan sheet inspection).",
    "Do NOT use other files from Project Drive, prior chat uploads, or unrelated project documents unless the user explicitly asks.",
    "",
    "Attached file(s) for this message:",
  ];
  for (const name of scope.fileNames) {
    lines.push(`- ${name}`);
  }
  return lines.join("\n");
}
