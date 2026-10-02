import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import {
  API_KEY_LIMIT_PER_ORG,
  deriveKeyStatus,
  generateApiKey,
} from "@/lib/apiKeys/token";
import { parsePermissions, type ApiKeyPermission } from "@/lib/apiKeys/permissions";

export const runtime = "nodejs";

const MAX_NAME_LENGTH = 100;

// POST /api/organizations/[id]/api-keys
// Mint a new API key. The plaintext is returned in this response and never again.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: organizationId } = await params;

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

    const body = await request.json().catch(() => null);
    const name = body?.name;

    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (name.trim().length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` },
        { status: 400 }
      );
    }

    // Grants are optional; a key created without them is read-only
    let permissions: ApiKeyPermission[] = [];
    if (body?.permissions !== undefined) {
      const parsed = parsePermissions(body.permissions);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      permissions = parsed.value;
    }

    const svc = getServiceClient();

    // Count active (non-revoked) keys against the cap; revoking frees a slot
    const { count, error: countError } = await svc
      .from("organization_api_keys")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("revoked_at", null);

    if (countError) {
      console.error("Failed to count API keys:", countError);
      return NextResponse.json({ error: "Failed to create API key" }, { status: 500 });
    }

    if ((count ?? 0) >= API_KEY_LIMIT_PER_ORG) {
      return NextResponse.json(
        {
          error: `This organization already has ${API_KEY_LIMIT_PER_ORG} active API keys. Revoke one before creating another.`,
          limit: API_KEY_LIMIT_PER_ORG,
        },
        { status: 400 }
      );
    }

    const { plaintext, prefix, hash } = generateApiKey();

    const { data: created, error: insertError } = await svc
      .from("organization_api_keys")
      .insert({
        organization_id: organizationId,
        name: name.trim(),
        key_prefix: prefix,
        key_hash: hash,
        created_by: user.id,
        permissions,
      })
      .select("id, name, key_prefix, permissions")
      .single();

    if (insertError || !created) {
      // Code and message only: a unique-violation's details would carry the hash
      console.error("Failed to create API key:", insertError?.code, insertError?.message);
      return NextResponse.json({ error: "Failed to create API key" }, { status: 500 });
    }

    return NextResponse.json({ ...created, key: plaintext }, { status: 201 });
  } catch (error) {
    console.error("Error creating API key:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/organizations/[id]/api-keys
// List the organization's API keys with derived status. Never returns key material.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: organizationId } = await params;

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

    const svc = getServiceClient();

    const { data: rows, error: listError } = await svc
      .from("organization_api_keys")
      .select("id, name, key_prefix, created_by, revoked_at, last_used_at, created_at, permissions")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (listError || !rows) {
      console.error("Failed to list API keys:", listError);
      return NextResponse.json({ error: "Failed to fetch API keys" }, { status: 500 });
    }

    // created_by references auth.users, so creators are resolved with a second query
    const creatorIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
    const { data: profiles } = creatorIds.length
      ? await svc.from("profiles").select("id, email, full_name").in("id", creatorIds)
      : { data: [] };

    const creatorMap = new Map(
      (profiles ?? []).map((p) => [p.id, p.full_name || p.email || null])
    );

    const keys = rows.map((row) => ({
      ...row,
      status: deriveKeyStatus(row),
      created_by_label: row.created_by ? creatorMap.get(row.created_by) ?? null : null,
    }));

    return NextResponse.json({ keys, max_keys: API_KEY_LIMIT_PER_ORG });
  } catch (error) {
    console.error("Error fetching API keys:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
