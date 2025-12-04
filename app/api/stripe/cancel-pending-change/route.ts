import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Verify authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get organization ID
    const { data: orgData } = await supabase.rpc(
      "get_user_organization_membership",
      { p_user_id: user.id }
    );
    const organizationId = orgData?.[0]?.organization_id;
    const userRole = orgData?.[0]?.role;

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Only owner can cancel pending changes
    if (userRole !== "owner") {
      return NextResponse.json(
        { error: "Only the owner can cancel pending plan changes" },
        { status: 403 }
      );
    }

    // Get current subscription to check for pending changes
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("pending_plan_change")
      .eq("organization_id", organizationId)
      .single();

    if (!subscription?.pending_plan_change) {
      return NextResponse.json(
        { error: "No pending plan change found" },
        { status: 404 }
      );
    }

    // Clear the pending plan change
    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({
        pending_plan_change: null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId);

    if (updateError) {
      console.error("Failed to cancel pending plan change:", updateError);
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      message: "Pending plan change canceled successfully",
    });
  } catch (error: any) {
    console.error("Cancel pending change error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to cancel pending change" },
      { status: 500 }
    );
  }
}

