import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enqueuePdfDocuments } from "@/lib/ai/enqueueDocumentProcessing";
import { ensureProjectDriveIndexed } from "@/lib/ai/projectDriveContext";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SweepBody {
  projectId?: string;
  maxDocs?: number;
}

/**
 * Background sweep: enqueue pending PDF processing and index non-PDF Drive files.
 * Call from cron, context route, or after Drive upload.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SweepBody = {};
  try {
    body = await request.json();
  } catch {
    // empty body ok
  }

  const maxDocs = body.maxDocs ?? 20;

  if (body.projectId) {
    const result = await ensureProjectDriveIndexed(supabase, body.projectId, { maxDocs });
    console.log(
      `[documents-sweep] project=${body.projectId} | indexed=${result.indexed} | pdfEnqueued=${result.pdfEnqueued} | pending=${result.pending}`,
    );
    return NextResponse.json({ ok: true, ...result });
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .limit(50);

  let totalEnqueued = 0;
  for (const p of projects ?? []) {
    const r = await enqueuePdfDocuments(supabase, p.id, { maxDocs: 5 });
    totalEnqueued += r.enqueued;
  }

  console.log(`[documents-sweep] global | pdfEnqueued=${totalEnqueued}`);
  return NextResponse.json({ ok: true, pdfEnqueued: totalEnqueued });
}

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  after(async () => {
    try {
      const bg = await createClient();
      await ensureProjectDriveIndexed(bg, projectId, { maxDocs: 15 });
    } catch (err) {
      console.error("[documents-sweep] background error", err);
    }
  });

  return NextResponse.json({ ok: true, scheduled: true });
}
