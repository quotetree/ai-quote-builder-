import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/util/slugify";

function buildShareUrl(request: NextRequest, slug: string, token: string) {
  const configuredBase = process.env.NEXT_PUBLIC_SHARE_BASE_URL?.trim();
  const base = configuredBase && configuredBase.length > 0 ? configuredBase : request.nextUrl.origin;
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;

  return `${normalizedBase}/share/${slug}/${token}`;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "You must be signed in to share a project." }, { status: 401 });
  }

  const { id: projectId } = await params;

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, project_name, share_token")
    .eq("id", projectId)
    .single();

  if (error || !project) {
    console.error("[Share API] Failed to fetch project:", { projectId, error, userId: user.id });
    return NextResponse.json({ 
      error: "Project not found.", 
      details: error?.message 
    }, { status: 404 });
  }

  let shareToken = project.share_token;

  if (!shareToken) {
    const newToken = randomBytes(16).toString("hex");
    const { data: updatedProject, error: updateError } = await supabase
      .from("projects")
      .update({
        share_token: newToken,
        share_token_created_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .select("id, project_name, share_token")
      .single();

    if (updateError || !updatedProject) {
      console.error("[Share API] Failed to update project with token:", { projectId, updateError });
      return NextResponse.json({ 
        error: "Could not create share link. Please try again.",
        details: updateError?.message
      }, { status: 500 });
    }

    shareToken = updatedProject.share_token;
  }

  const slug = slugify(project.project_name);
  const shareUrl = buildShareUrl(request, slug, shareToken);

  return NextResponse.json({ shareUrl, shareToken });
}


