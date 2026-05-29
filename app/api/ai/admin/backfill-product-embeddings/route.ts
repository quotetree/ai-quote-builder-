import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRetrievalAdmin } from "@/lib/ai/admin/requireRetrievalAdmin";
import { indexProductEmbeddings } from "@/lib/ai/embeddings/indexEntities";

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

  let body: { limit?: number; productIds?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body ok */
  }

  try {
    const result = await indexProductEmbeddings(supabase, admin.organizationId, {
      limit: body.limit,
      productIds: body.productIds,
    });
    console.log(
      `[backfill-product-embeddings] org=${admin.organizationId} indexed=${result.indexed} skipped=${result.skipped} errors=${result.errors}`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Backfill failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
