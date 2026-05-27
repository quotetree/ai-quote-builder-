import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  isValidPlanPdfStoragePath,
  MAX_PLAN_PDF_BYTES,
} from "@/lib/ai/planFileValidation";
import { triggerDocumentProcessing } from "@/lib/ai/triggerDocumentProcessing";

export const runtime = "nodejs";

interface RegisterBody {
  projectId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RegisterBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, storagePath, fileName, mimeType, fileSize } = body;

  if (!projectId || !storagePath || !fileName) {
    return NextResponse.json(
      { error: "projectId, storagePath, and fileName are required" },
      { status: 400 },
    );
  }

  if (!isValidPlanPdfStoragePath(projectId, storagePath)) {
    return NextResponse.json({ error: "Invalid storage path" }, { status: 400 });
  }

  if (fileSize > MAX_PLAN_PDF_BYTES) {
    return NextResponse.json({ error: "File exceeds 150MB limit" }, { status: 400 });
  }

  const normalizedMime = mimeType || "application/pdf";
  if (
    normalizedMime !== "application/pdf" &&
    !fileName.toLowerCase().endsWith(".pdf")
  ) {
    return NextResponse.json(
      { error: "Only PDF files can be registered on this endpoint" },
      { status: 400 },
    );
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  const { data: doc, error: docError } = await supabase
    .from("project_documents")
    .insert({
      project_id: projectId,
      file_name: fileName,
      file_type: normalizedMime,
      mime_type: normalizedMime,
      file_size: fileSize,
      storage_path: storagePath,
      uploaded_by: user.id,
      upload_status: "uploaded",
      processing_status: "pending",
      parse_status: "pending",
      doc_source: "plan_upload",
      folder_id: null,
    })
    .select("id")
    .single();

  if (docError || !doc) {
    return NextResponse.json(
      { error: docError?.message ?? "Failed to create document" },
      { status: 500 },
    );
  }

  const { data: attachment, error: attError } = await supabase
    .from("chat_attachments")
    .insert({
      project_id: projectId,
      uploaded_by: user.id,
      file_name: fileName,
      mime_type: normalizedMime,
      file_size: fileSize,
      storage_path: storagePath,
      parse_status: "pending",
      source: "plan_upload",
      project_document_id: doc.id,
      updated_at: now,
    })
    .select("id, file_name, mime_type, parse_status, parse_error, project_document_id")
    .single();

  if (attError || !attachment) {
    await supabase.from("project_documents").delete().eq("id", doc.id);
    return NextResponse.json(
      { error: attError?.message ?? "Failed to create attachment" },
      { status: 500 },
    );
  }

  after(async () => {
    await triggerDocumentProcessing(doc.id, projectId);
  });

  return NextResponse.json({
    documentId: doc.id,
    attachment,
  });
}
