import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const attachmentId = request.nextUrl.searchParams.get("attachmentId");
  if (!attachmentId) {
    return NextResponse.json({ error: "attachmentId is required" }, { status: 400 });
  }

  const { data: attachment, error } = await supabase
    .from("chat_attachments")
    .select(
      "id, file_name, mime_type, parse_status, parse_error, project_document_id, project_id",
    )
    .eq("id", attachmentId)
    .maybeSingle();

  if (error || !attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  if (!attachment.project_document_id) {
    return NextResponse.json({
      attachmentId: attachment.id,
      fileName: attachment.file_name,
      uploadStatus: "uploaded",
      processingStatus:
        attachment.parse_status === "ready"
          ? "ready"
          : attachment.parse_status === "error"
            ? "failed"
            : "processing",
      parseError: attachment.parse_error,
      pageCount: null,
      processingProgress: null,
      documentId: null,
    });
  }

  const { data: doc } = await supabase
    .from("project_documents")
    .select(
      "id, upload_status, processing_status, parse_error, page_count, processing_progress",
    )
    .eq("id", attachment.project_document_id)
    .maybeSingle();

  // PDF pipeline: only report ready when the document row says so (never infer from attachment row).
  const processingStatus = doc?.processing_status ?? "processing";

  return NextResponse.json({
    attachmentId: attachment.id,
    fileName: attachment.file_name,
    documentId: doc?.id ?? attachment.project_document_id,
    uploadStatus: doc?.upload_status ?? "uploaded",
    processingStatus,
    parseError: doc?.parse_error ?? attachment.parse_error,
    pageCount: doc?.page_count ?? null,
    processingProgress: doc?.processing_progress ?? null,
  });
}
