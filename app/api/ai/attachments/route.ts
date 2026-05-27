import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not read upload. Files must be under 20MB. Very large PDFs may need to be compressed first.",
      },
      { status: 413 },
    );
  }

  const projectId = formData.get("projectId");
  const file = formData.get("file");

  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const lowerName = (file.name || "").toLowerCase();
  if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
    return NextResponse.json(
      {
        error:
          "PDFs must use the document upload flow. Refresh the page if this persists.",
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File exceeds 20MB limit" }, { status: 400 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const safeName = sanitizeFileName(file.name || "upload");
  const uniqueId = crypto.randomUUID();
  const storagePath = `project-${projectId}/chat/${uniqueId}-${safeName}`;
  const mimeType = file.type || "application/octet-stream";
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("project-files")
    .upload(storagePath, buffer, {
      contentType: mimeType,
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: row, error: insertError } = await supabase
    .from("chat_attachments")
    .insert({
      project_id: projectId,
      uploaded_by: user.id,
      file_name: file.name || safeName,
      mime_type: mimeType,
      file_size: file.size,
      storage_path: storagePath,
      parse_status: "ready",
      source: "plan_upload",
    })
    .select("id, file_name, mime_type, parse_status, parse_error")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ attachment: row });
}
