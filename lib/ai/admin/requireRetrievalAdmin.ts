import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function requireRetrievalAdmin(
  supabase: SupabaseClient,
  user: User,
): Promise<{ organizationId: string; role: string } | { error: string; status: number }> {
  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .in("role", ["owner", "super_admin", "admin"])
    .limit(1)
    .maybeSingle();

  if (!membership?.organization_id) {
    return { error: "Admin access required", status: 403 };
  }

  return {
    organizationId: membership.organization_id as string,
    role: membership.role as string,
  };
}
