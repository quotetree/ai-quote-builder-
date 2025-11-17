import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

type SharePageParams = {
  projectSlug: string;
  token: string;
};

export default async function SharedProjectGate({ params }: { params: Promise<SharePageParams> }) {
  const { projectSlug, token } = await params;
  
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sharePath = `/share/${projectSlug}/${token}`;

  if (!user) {
    redirect(`/auth/signin?redirectTo=${encodeURIComponent(sharePath)}`);
  }

  const serviceClient = getServiceClient();
  const { data: project, error } = await serviceClient
    .from("projects")
    .select("id, project_name, user_id, share_token")
    .eq("share_token", token)
    .single();
  
  console.log("[Share Gate] Looking up project:", { token, found: !!project, error });

  if (!project) {
    return <InvalidShareLink />;
  }

  const { data: viewerProfile } = await serviceClient
    .from("profiles")
    .select("id, company_name")
    .eq("id", user.id)
    .single();

  const { data: ownerProfile } = await serviceClient
    .from("profiles")
    .select("id, company_name")
    .eq("id", project.user_id)
    .single();

  const sameOrg =
    project.user_id === user.id ||
    (!!ownerProfile?.company_name &&
      !!viewerProfile?.company_name &&
      ownerProfile.company_name === viewerProfile.company_name);

  if (!sameOrg) {
    return <AccessDeniedView />;
  }

  redirect(`/projects/${project.id}`);
}

function AccessDeniedView() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md rounded-xl bg-white p-8 text-center shadow">
        <h1 className="text-2xl font-semibold text-gray-900">Access denied</h1>
        <p className="mt-2 text-sm text-gray-600">
          This project belongs to a different organization. Please ask the owner to invite you to their workspace.
        </p>
        <div className="mt-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Return to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function InvalidShareLink() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md rounded-xl bg-white p-8 text-center shadow">
        <h1 className="text-2xl font-semibold text-gray-900">Link not found</h1>
        <p className="mt-2 text-sm text-gray-600">
          This share link is no longer valid. Please ask the project owner for a new link.
        </p>
        <div className="mt-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Return to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}


