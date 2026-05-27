import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { triggerDocumentProcessing } from "@/lib/ai/triggerDocumentProcessing";

export const runtime = "nodejs";
export const maxDuration = 300;

interface ProcessBody {
  projectId: string;
  documentId: string;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ProcessBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, documentId } = body;
  if (!projectId || !documentId) {
    return NextResponse.json(
      { error: "projectId and documentId are required" },
      { status: 400 },
    );
  }

  const { data: doc } = await supabase
    .from("project_documents")
    .select("id")
    .eq("id", documentId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  await supabase
    .from("project_documents")
    .update({
      processing_status: "pending",
      parse_status: "pending",
      parse_error: null,
      processing_progress: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("project_id", projectId);

  await triggerDocumentProcessing(documentId, projectId);

  const { data: updated } = await supabase
    .from("project_documents")
    .select(
      "id, processing_status, parse_status, parse_error, page_count, processing_progress",
    )
    .eq("id", documentId)
    .single();

  return NextResponse.json({ ok: true, document: updated });
}
