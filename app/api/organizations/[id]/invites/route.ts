import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendOrganizationInvite } from "@/lib/email/organizationInvite";
import crypto from "crypto";

// POST /api/organizations/[id]/invites
// Create and send a new organization invite
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: organizationId } = await params;

    // Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { email, role } = body;

    if (!email || !role) {
      return NextResponse.json(
        { error: "Email and role are required" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // SECURITY: Reject owner role invites
    if (role === "owner") {
      return NextResponse.json(
        { error: "Owner can only be set at org creation, not via invite." },
        { status: 400 }
      );
    }

    // Validate role
    if (role !== "super_admin" && role !== "admin") {
      return NextResponse.json(
        { error: "Role must be either 'super_admin' or 'admin'" },
        { status: 400 }
      );
    }

    // Verify user has permission to invite (owner or super_admin)
    const { data: membership, error: membershipError } = await supabase
      .from("organization_memberships")
      .select("role, organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "You are not a member of this organization" },
        { status: 403 }
      );
    }

    if (membership.role !== "owner" && membership.role !== "super_admin") {
      return NextResponse.json(
        { error: "Only owners and super admins can invite members" },
        { status: 403 }
      );
    }

    // Check if the invited email is already a member
    // First, check if this email belongs to an existing user
    const { data: inviteeProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    // If the email belongs to an existing user, check if they're already a member
    if (inviteeProfile) {
      const { data: existingMember } = await supabase
        .from("organization_memberships")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("user_id", inviteeProfile.id)
        .maybeSingle();

      if (existingMember) {
        return NextResponse.json(
          { error: "This user is already a member of the organization" },
          { status: 400 }
        );
      }
    }

    // Check for existing pending invitation
    const { data: existingInvite } = await supabase
      .from("organization_invitations")
      .select("id, status")
      .eq("organization_id", organizationId)
      .eq("email", email.toLowerCase())
      .eq("status", "pending")
      .maybeSingle();

    if (existingInvite) {
      return NextResponse.json(
        { error: "An invitation has already been sent to this email" },
        { status: 400 }
      );
    }

    // Check license availability
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("total_licenses")
      .eq("organization_id", organizationId)
      .single();

    const { count: currentMemberCount } = await supabase
      .from("organization_memberships")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId);

    const usedLicenses = currentMemberCount || 0;
    const totalLicenses = subscription?.total_licenses || 1;

    if (usedLicenses >= totalLicenses) {
      return NextResponse.json(
        {
          error: "No available licenses. Please add more licenses before inviting members.",
          usedLicenses,
          totalLicenses,
        },
        { status: 400 }
      );
    }

    // Get organization and inviter details
    const { data: organization } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .single();

    const { data: inviterProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();

    if (!organization) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Generate secure random token
    const inviteToken = crypto.randomBytes(32).toString("hex");

    // Set expiration to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Create invitation record
    const { data: invitation, error: inviteError } = await supabase
      .from("organization_invitations")
      .insert({
        organization_id: organizationId,
        email: email.toLowerCase(),
        role,
        invited_by: user.id,
        invitation_token: inviteToken,
        status: "pending",
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (inviteError) {
      console.error("Failed to create invitation:", inviteError);
      return NextResponse.json(
        { error: "Failed to create invitation" },
        { status: 500 }
      );
    }

    // Send invitation email
    try {
      await sendOrganizationInvite({
        recipientEmail: email,
        organizationName: organization.name,
        inviterName: inviterProfile?.full_name || inviterProfile?.email || "A team member",
        role,
        inviteToken,
      });
    } catch (emailError) {
      console.error("Failed to send invitation email:", emailError);
      
      // Delete the invitation if email fails
      await supabase
        .from("organization_invitations")
        .delete()
        .eq("id", invitation.id);

      return NextResponse.json(
        { error: "Failed to send invitation email. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expires_at: invitation.expires_at,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating invitation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET /api/organizations/[id]/invites
// List all invitations for an organization
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: organizationId } = await params;

    // Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Verify user is a member of the organization
    const { data: membership, error: membershipError } = await supabase
      .from("organization_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "You are not a member of this organization" },
        { status: 403 }
      );
    }

    // Get all invitations for the organization
    const { data: invitations, error: invitesError } = await supabase
      .from("organization_invitations")
      .select("id, email, role, status, expires_at, created_at, invited_by")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (invitesError) {
      console.error("Failed to fetch invitations:", invitesError);
      return NextResponse.json(
        { error: "Failed to fetch invitations" },
        { status: 500 }
      );
    }

    // Get inviter profiles
    const inviterIds = [...new Set(invitations?.map(inv => inv.invited_by).filter(Boolean))];
    const { data: inviters } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", inviterIds);

    const inviterMap = new Map(inviters?.map(inv => [inv.id, inv]) || []);

    // Enrich invitations with inviter info
    const enrichedInvitations = invitations?.map(inv => ({
      ...inv,
      inviter: inv.invited_by ? inviterMap.get(inv.invited_by) : null,
    }));

    return NextResponse.json({
      invitations: enrichedInvitations,
    });
  } catch (error) {
    console.error("Error fetching invitations:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/organizations/[id]/invites/[inviteId]
// Revoke an invitation
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: organizationId } = await params;
    
    // Get invite ID from URL search params
    const { searchParams } = new URL(request.url);
    const inviteId = searchParams.get("inviteId");

    if (!inviteId) {
      return NextResponse.json(
        { error: "Invite ID is required" },
        { status: 400 }
      );
    }

    // Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Verify user has permission (owner or super_admin)
    const { data: membership, error: membershipError } = await supabase
      .from("organization_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "You are not a member of this organization" },
        { status: 403 }
      );
    }

    if (membership.role !== "owner" && membership.role !== "super_admin") {
      return NextResponse.json(
        { error: "Only owners and super admins can revoke invitations" },
        { status: 403 }
      );
    }

    // Update invitation status to revoked
    const { error: updateError } = await supabase
      .from("organization_invitations")
      .update({ status: "revoked" })
      .eq("id", inviteId)
      .eq("organization_id", organizationId);

    if (updateError) {
      console.error("Failed to revoke invitation:", updateError);
      return NextResponse.json(
        { error: "Failed to revoke invitation" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Invitation revoked successfully",
    });
  } catch (error) {
    console.error("Error revoking invitation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

