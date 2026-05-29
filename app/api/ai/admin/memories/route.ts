import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRetrievalAdmin } from "@/lib/ai/admin/requireRetrievalAdmin";
import { indexMemoryEmbedding } from "@/lib/ai/embeddings/indexEntities";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
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

  const scope = request.nextUrl.searchParams.get("scope");
  const projectId = request.nextUrl.searchParams.get("projectId");

  let query = supabase
    .from("copilot_memories")
    .select(
      "id, scope, title, content, tags, is_enabled, user_id, project_id, created_at, updated_at",
    )
    .eq("organization_id", admin.organizationId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (scope) query = query.eq("scope", scope);
  if (projectId) query = query.eq("project_id", projectId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ memories: data ?? [] });
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

  let body: {
    scope: "user" | "organization" | "project";
    content: string;
    title?: string;
    tags?: string[];
    projectId?: string;
    userId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.content?.trim() || !body.scope) {
    return NextResponse.json({ error: "scope and content are required" }, { status: 400 });
  }

  const row: Record<string, unknown> = {
    organization_id: admin.organizationId,
    scope: body.scope,
    title: body.title?.trim() || null,
    content: body.content.trim(),
    tags: body.tags ?? [],
    created_by: user.id,
    is_enabled: true,
  };

  if (body.scope === "user") {
    row.user_id = body.userId ?? user.id;
  } else if (body.scope === "project") {
    if (!body.projectId) {
      return NextResponse.json({ error: "projectId required for project scope" }, { status: 400 });
    }
    row.project_id = body.projectId;
  }

  const { data, error } = await supabase
    .from("copilot_memories")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await indexMemoryEmbedding(supabase, data.id as string);

  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(request: NextRequest) {
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

  let body: { id: string; is_enabled?: boolean; content?: string; title?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.is_enabled === "boolean") updates.is_enabled = body.is_enabled;
  if (body.content !== undefined) updates.content = body.content.trim();
  if (body.title !== undefined) updates.title = body.title?.trim() || null;

  const { error } = await supabase
    .from("copilot_memories")
    .update(updates)
    .eq("id", body.id)
    .eq("organization_id", admin.organizationId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.content !== undefined) {
    await indexMemoryEmbedding(supabase, body.id);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
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

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }

  const hardDelete = request.nextUrl.searchParams.get("hard") === "true";

  if (hardDelete) {
    const { error } = await supabase
      .from("copilot_memories")
      .delete()
      .eq("id", id)
      .eq("organization_id", admin.organizationId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await supabase
      .from("copilot_memories")
      .update({ is_enabled: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", admin.organizationId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
