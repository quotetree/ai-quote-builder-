import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRetrievalAdmin } from "@/lib/ai/admin/requireRetrievalAdmin";
import { triggerDocumentProcessing } from "@/lib/ai/triggerDocumentProcessing";
import { upsertProjectRetrievalProfile } from "@/lib/ai/retrieval/priorProjectRetrieval";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  projectId: string;
  documentIds?: string[];
  rebuildProjectProfile?: boolean;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await requireRetrievalAdmin(supabase, user);
  if ("error" in admin) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, organization_id")
    .eq("id", body.projectId)
    .eq("organization_id", admin.organizationId)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let query = supabase
    .from("project_documents")
    .select("id")
    .eq("project_id", body.projectId);

  if (body.documentIds?.length) {
    query = query.in("id", body.documentIds);
  }

  const { data: docs } = await query;
  const enqueued: string[] = [];

  for (const doc of docs ?? []) {
    await supabase
      .from("project_documents")
      .update({
        processing_status: "pending",
        parse_status: "pending",
        parse_error: null,
        processing_progress: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", doc.id)
      .eq("project_id", body.projectId);

    await triggerDocumentProcessing(doc.id as string, body.projectId);
    enqueued.push(doc.id as string);
  }

  if (body.rebuildProjectProfile !== false) {
    await upsertProjectRetrievalProfile(
      supabase,
      admin.organizationId,
      body.projectId,
    );
  }

  console.log(
    `[reindex-project-documents] project=${body.projectId} enqueued=${enqueued.length}`,
  );

  return NextResponse.json({
    ok: true,
    projectId: body.projectId,
    documentsEnqueued: enqueued.length,
    documentIds: enqueued,
  });
}
