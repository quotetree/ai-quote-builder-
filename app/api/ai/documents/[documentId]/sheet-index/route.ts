import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { documentId } = await context.params;
  const projectId = request.nextUrl.searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId query param required" }, { status: 400 });
  }

  const { data: doc } = await supabase
    .from("project_documents")
    .select("id, file_name, page_count, processing_status")
    .eq("id", documentId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const { data: sheets } = await supabase
    .from("document_sheet_index")
    .select(
      "id, sheet_number, sheet_title, discipline, trade, page_number, revision, confidence",
    )
    .eq("document_id", documentId)
    .eq("project_id", projectId)
    .order("sheet_number", { ascending: true });

  const { data: pagesWithImages } = await supabase
    .from("document_pages")
    .select("page_number, storage_path, sheet_number, sheet_title")
    .eq("document_id", documentId)
    .not("storage_path", "is", null)
    .order("page_number", { ascending: true });

  return NextResponse.json({
    document: doc,
    sheets: sheets ?? [],
    pagesWithImages: (pagesWithImages ?? []).length,
    sheetCount: sheets?.length ?? 0,
  });
}
