import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ─── GET /api/firma/contacts?q=search ────────────────────────────────────────
// Returns contacts for the authenticated user's organization, filtered by query.

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();

  // Get the user's organization
  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership?.organization_id) {
    return NextResponse.json({ contacts: [] });
  }

  let query = supabase
    .from("proposal_contacts")
    .select("id, first_name, last_name, email, phone")
    .eq("organization_id", membership.organization_id)
    .order("first_name");

  if (q) {
    // Filter by name or email (case-insensitive)
    query = query.or(
      `first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`
    );
  }

  const { data: contacts, error } = await query.limit(20);

  if (error) {
    console.error("[firma/contacts GET]", error.message);
    return NextResponse.json({ error: "Failed to load contacts" }, { status: 500 });
  }

  return NextResponse.json({ contacts: contacts ?? [] });
}

// ─── POST /api/firma/contacts ─────────────────────────────────────────────────
// Creates or updates a contact for the authenticated user's organization.

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { first_name: string; last_name?: string; email: string; phone?: string };
  try {
    body = await req.json();
    if (!body.first_name || !body.email) {
      return NextResponse.json({ error: "first_name and email are required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership?.organization_id) {
    return NextResponse.json({ error: "No organization found" }, { status: 400 });
  }

  const { data: contact, error } = await supabase
    .from("proposal_contacts")
    .upsert(
      {
        organization_id: membership.organization_id,
        first_name: body.first_name,
        last_name: body.last_name ?? "",
        email: body.email.toLowerCase().trim(),
        phone: body.phone ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,email" }
    )
    .select()
    .single();

  if (error) {
    console.error("[firma/contacts POST]", error.message);
    return NextResponse.json({ error: "Failed to save contact" }, { status: 500 });
  }

  return NextResponse.json({ contact });
}
