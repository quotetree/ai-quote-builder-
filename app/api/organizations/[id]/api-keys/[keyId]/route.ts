import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DELETE /api/organizations/[id]/api-keys/[keyId]
// Revoke an API key. Idempotent: revoking an already-revoked key returns the
// original revoked_at rather than moving it.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: organizationId, keyId } = await params;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user has permission (owner or super_admin) before touching the key table
    const { data: membership } = await supabase
      .from("organization_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .single();

    if (!membership || (membership.role !== "owner" && membership.role !== "super_admin")) {
      return NextResponse.json(
        { error: "Only owners and super admins can manage API keys" },
        { status: 403 }
      );
    }

    // A non-uuid id cannot name a key, and would otherwise surface as a database error
    if (!UUID_PATTERN.test(keyId)) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    const svc = getServiceClient();

    // Only a live key is updated, so a retry never moves the recorded revocation time
    const { data: updated, error: updateError } = await svc
      .from("organization_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyId)
      .eq("organization_id", organizationId)
      .is("revoked_at", null)
      .select("id, revoked_at");

    if (updateError) {
      console.error("Failed to revoke API key:", updateError);
      return NextResponse.json({ error: "Failed to revoke API key" }, { status: 500 });
    }

    if (updated && updated.length > 0) {
      return NextResponse.json(updated[0], { status: 200 });
    }

    // Nothing updated: either no such key in this org, or it was already revoked
    const { data: existing, error: readError } = await svc
      .from("organization_api_keys")
      .select("id, revoked_at")
      .eq("id", keyId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (readError) {
      console.error("Failed to read API key:", readError);
      return NextResponse.json({ error: "Failed to revoke API key" }, { status: 500 });
    }

    if (!existing) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    return NextResponse.json(existing, { status: 200 });
  } catch (error) {
    console.error("Error revoking API key:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
