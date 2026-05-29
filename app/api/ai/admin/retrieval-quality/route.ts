import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRetrievalAdmin } from "@/lib/ai/admin/requireRetrievalAdmin";
import { isHybridRetrievalEnabled } from "@/lib/ai/documentProcessingConfig";

export const runtime = "nodejs";

export async function GET() {
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

  const orgId = admin.organizationId;

  const { data: orgProjects } = await supabase
    .from("projects")
    .select("id")
    .eq("organization_id", orgId);
  const projectIds = (orgProjects ?? []).map((p) => p.id as string);

  const [productsTotal, productsEmbedded, memoriesTotal, memoriesEmbedded, profilesTotal, profilesEmbedded] =
    await Promise.all([
      supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .not("embedding", "is", null),
      supabase
        .from("copilot_memories")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("is_enabled", true),
      supabase
        .from("copilot_memories")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("is_enabled", true)
        .not("embedding", "is", null),
      supabase
        .from("project_retrieval_profiles")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId),
      supabase
        .from("project_retrieval_profiles")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .not("embedding", "is", null),
    ]);

  let chunkCount = 0;
  let chunkEmbedded = 0;
  if (projectIds.length > 0) {
    const [totalRes, embRes] = await Promise.all([
      supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .in("project_id", projectIds),
      supabase
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .in("project_id", projectIds)
        .not("embedding", "is", null),
    ]);
    chunkCount = totalRes.count ?? 0;
    chunkEmbedded = embRes.count ?? 0;
  }

  return NextResponse.json({
    hybridRetrievalEnabled: isHybridRetrievalEnabled(),
    organizationId: orgId,
    products: {
      total: productsTotal.count ?? 0,
      embedded: productsEmbedded.count ?? 0,
    },
    memories: {
      total: memoriesTotal.count ?? 0,
      embedded: memoriesEmbedded.count ?? 0,
    },
    projectProfiles: {
      total: profilesTotal.count ?? 0,
      embedded: profilesEmbedded.count ?? 0,
    },
    documentChunks: {
      total: chunkCount,
      embedded: chunkEmbedded,
    },
  });
}
