import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildQuoteContext } from "@/lib/ai/buildQuoteContext";
import { ensureProjectDriveIndexed } from "@/lib/ai/projectDriveContext";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get("projectId");
  const spreadsheetId =
    request.nextUrl.searchParams.get("spreadsheetId") ||
    request.nextUrl.searchParams.get("activeSpreadsheetId");

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId query parameter is required" },
      { status: 400 },
    );
  }

  const context = await buildQuoteContext(
    supabase,
    projectId,
    spreadsheetId || null,
  );

  if (!context) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  after(async () => {
    try {
      const bg = await createClient();
      await ensureProjectDriveIndexed(bg, projectId, { maxDocs: 15 });
    } catch (err) {
      console.error("[context] drive index background error", err);
    }
  });

  return NextResponse.json({ context, driveIndexing: "scheduled" });
}
