import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ProjectWorkspace from "@/components/ProjectWorkspace";

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/signin");
  }

  // Await params for Next.js 15+
  const { id } = await Promise.resolve(params);

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_name")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!project) {
    redirect("/projects/new");
  }

  return <ProjectWorkspace projectId={project.id} projectName={project.project_name} />;
}

