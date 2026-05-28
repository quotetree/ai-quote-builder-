import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectDriveIndexed } from "@/lib/ai/projectDriveContext";

export const runtime = "nodejs";
export const maxDuration = 120;

interface DriveIndexBody {
  projectId: string;
  documentIds?: string[];
  maxDocs?: number;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: DriveIndexBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, documentIds, maxDocs } = body;
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const result = await ensureProjectDriveIndexed(supabase, projectId, {
    documentIds,
    maxDocs: maxDocs ?? 12,
  });

  console.log(
    `[drive-index] ✅ project=${projectId} | indexed=${result.indexed} | pdfEnqueued=${result.pdfEnqueued} | pending=${result.pending}`,
  );

  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const { data: docs } = await supabase
    .from("project_documents")
    .select("id, file_name, parse_status, indexed_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = docs ?? [];
  const pending = rows.filter(
    (d) => d.parse_status === "pending" || d.parse_status === "processing",
  ).length;
  const ready = rows.filter((d) => d.parse_status === "ready").length;
  const error = rows.filter((d) => d.parse_status === "error").length;

  return NextResponse.json({
    projectId,
    total: rows.length,
    ready,
    pending,
    error,
    files: rows,
  });
}
