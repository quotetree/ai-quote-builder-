import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRetrievalAdmin } from "@/lib/ai/admin/requireRetrievalAdmin";
import { upsertProjectRetrievalProfile } from "@/lib/ai/retrieval/priorProjectRetrieval";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  let body: { limit?: number } = {};
  try {
    body = await request.json();
  } catch {
    /* optional */
  }

  const limit = body.limit ?? 50;

  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("organization_id", admin.organizationId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  let indexed = 0;
  let errors = 0;

  for (const p of projects ?? []) {
    try {
      await upsertProjectRetrievalProfile(
        supabase,
        admin.organizationId,
        p.id as string,
      );
      indexed += 1;
    } catch {
      errors += 1;
    }
  }

  console.log(
    `[backfill-project-profiles] org=${admin.organizationId} indexed=${indexed} errors=${errors}`,
  );

  return NextResponse.json({ ok: true, indexed, errors, scanned: projects?.length ?? 0 });
}
