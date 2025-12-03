"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Plus, Mail, AlertCircle, Crown, Shield, User, Search, MoreVertical } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import {
  OrganizationMemberWithProfile,
  OrganizationInvitation,
  MemberRole,
  UserOrganizationContext,
  Subscription,
  BillingCycle,
  PLAN_PRICING
} from "@/types/database";
import { addLicenses } from "@/lib/stripe/client-utils";

interface MembersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MembersModal({ isOpen, onClose }: MembersModalProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [orgContext, setOrgContext] = useState<UserOrganizationContext | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [members, setMembers] = useState<OrganizationMemberWithProfile[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [searchFilter, setSearchFilter] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAddLicenseModal, setShowAddLicenseModal] = useState(false);
  const [emailPills, setEmailPills] = useState<string[]>([]);
  const [currentEmailInput, setCurrentEmailInput] = useState("");
  const [inviteRole, setInviteRole] = useState<"super_admin" | "admin">("admin");
  const [inviting, setInviting] = useState(false);
  const [additionalLicensesToAdd, setAdditionalLicensesToAdd] = useState(1);
  const [openMemberMenu, setOpenMemberMenu] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      // Store current user ID
      setCurrentUserId(user.id);

      // Get organization context
      const { data: contextData, error: contextError } = await supabase
        .rpc("get_user_organization_membership", { p_user_id: user.id });

      if (contextError) {
        console.error("Organization context error:", contextError);
        throw contextError;
      }
      if (!contextData || contextData.length === 0) {
        throw new Error("No organization found");
      }

      const context = contextData[0] as UserOrganizationContext;
      setOrgContext(context);

      // Get subscription details
      const { data: subData, error: subError } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("organization_id", context.organization_id)
        .single();

      if (subError) {
        console.error("Subscription query error:", subError);
      } else {
        setSubscription(subData);
      }

      // Get members
      const { data: membersData, error: membersError } = await supabase
        .from("organization_memberships")
        .select("*")
        .eq("organization_id", context.organization_id)
        .order("created_at", { ascending: true });

      if (membersError) {
        console.error("Members query error:", membersError);
        throw membersError;
      }

      // Get profiles separately for each member
      const membersWithProfiles = await Promise.all(
        (membersData || []).map(async (member) => {
          const { data: profileData } = await supabase
            .from("profiles")
            .select("email, full_name, company_name")
            .eq("id", member.user_id)
            .single();

          return {
            ...member,
            profile: profileData || { email: "", full_name: null, company_name: null },
          };
        })
      );

      setMembers(membersWithProfiles);

      // Get pending invitations
      const { data: invitesData, error: invitesError } = await supabase
        .from("organization_invitations")
        .select("*")
        .eq("organization_id", context.organization_id)
        .eq("status", "pending");

      if (invitesError) throw invitesError;
      setInvitations(invitesData || []);
    } catch (error: any) {
      console.error("Failed to load members:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      const errorMessage = error?.message || error?.error_description || error?.hint || "Failed to load members";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openMemberMenu) {
        setOpenMemberMenu(null);
      }
    };

    if (openMemberMenu) {
      document.addEventListener("click", handleClickOutside);
    }

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [openMemberMenu]);

  const canManageMembers = orgContext?.role === "owner" || orgContext?.role === "super_admin";

  // Validate email format
  const isValidEmail = (email: string) => {
    return email.includes("@") && email.length > 3;
  };

  // Handle email input - create pills on comma or space
  const handleEmailInput = (value: string) => {
    // Check if comma or space was entered
    if (value.includes(",") || value.includes(" ")) {
      const emails = value
        .split(/[,\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0);

      const validEmails = emails.filter(isValidEmail);
      const newPills = [...emailPills];

      validEmails.forEach((email) => {
        if (!newPills.includes(email)) {
          newPills.push(email);
        }
      });

      setEmailPills(newPills);
      setCurrentEmailInput("");
    } else {
      setCurrentEmailInput(value);
    }
  };

  // Handle key down for Enter and Backspace
  const handleEmailKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && currentEmailInput.trim()) {
      e.preventDefault();
      const email = currentEmailInput.trim().toLowerCase();
      if (isValidEmail(email) && !emailPills.includes(email)) {
        setEmailPills([...emailPills, email]);
      }
      setCurrentEmailInput("");
    } else if (e.key === "Backspace" && !currentEmailInput && emailPills.length > 0) {
      // Remove last pill if backspace on empty input
      setEmailPills(emailPills.slice(0, -1));
    }
  };

  // Remove email pill
  const removeEmailPill = (email: string) => {
    setEmailPills(emailPills.filter((e) => e !== email));
  };

  const handleInviteMembers = async () => {
    if (!orgContext || !canManageMembers) {
      toast.error("You don't have permission to invite members");
      return;
    }

    // Add current input to pills if it's a valid email
    let finalEmailList = [...emailPills];
    if (currentEmailInput.trim() && isValidEmail(currentEmailInput.trim().toLowerCase())) {
      const email = currentEmailInput.trim().toLowerCase();
      if (!finalEmailList.includes(email)) {
        finalEmailList.push(email);
      }
    }

    if (finalEmailList.length === 0) {
      toast.error("Please enter at least one valid email address");
      return;
    }

    // Check if there are enough available licenses
    if (orgContext.available_licenses < finalEmailList.length) {
      toast.error(
        `Not enough licenses available. You have ${orgContext.available_licenses} license(s) but trying to invite ${finalEmailList.length} member(s). Please add more licenses first.`,
        { duration: 5000 }
      );
      return;
    }

    setInviting(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      for (const email of finalEmailList) {
        try {
          // Check if user already exists
          const { data: existingUser } = await supabase
            .from("profiles")
            .select("id")
            .eq("email", email)
            .single();

          if (existingUser) {
            // Check if already a member
            const { data: existingMember } = await supabase
              .from("organization_memberships")
              .select("id")
              .eq("organization_id", orgContext.organization_id)
              .eq("user_id", existingUser.id)
              .single();

            if (existingMember) {
              toast.error(`${email} is already a member`);
              errorCount++;
              continue;
            }

            // Add directly as member
            const { error: memberError } = await supabase
              .from("organization_memberships")
              .insert({
                organization_id: orgContext.organization_id,
                user_id: existingUser.id,
                role: inviteRole,
                invited_by: user.id,
                invited_at: new Date().toISOString(),
                joined_at: new Date().toISOString(),
              });

            if (memberError) throw memberError;
            successCount++;
          } else {
            // Send email invitation
            const token = crypto.randomUUID();
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

            const { error: inviteError } = await supabase
              .from("organization_invitations")
              .insert({
                organization_id: orgContext.organization_id,
                email: email,
                role: inviteRole,
                invited_by: user.id,
                invitation_token: token,
                status: "pending",
                expires_at: expiresAt.toISOString(),
              });

            if (inviteError) throw inviteError;
            successCount++;
          }
        } catch (error: any) {
          console.error(`Failed to invite ${email}:`, error);
          errorCount++;
        }
      }

      if (successCount > 0) {
        toast.success(
          `Successfully invited ${successCount} member${successCount !== 1 ? "s" : ""}!`,
          { duration: 3000 }
        );
      }
      if (errorCount > 0) {
        toast.error(`Failed to invite ${errorCount} member${errorCount !== 1 ? "s" : ""}`);
      }

      setEmailPills([]);
      setCurrentEmailInput("");
      setInviteRole("admin");
      setShowInviteModal(false);
      await loadData();
    } catch (error: any) {
      console.error("Failed to invite members:", error);
      toast.error(error.message || "Failed to invite members");
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (memberId: string, memberEmail: string) => {
    if (!orgContext || !canManageMembers) {
      toast.error("You don't have permission to remove members");
      return;
    }

    if (!confirm(`Are you sure you want to remove ${memberEmail} from your organization?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from("organization_memberships")
        .delete()
        .eq("id", memberId);

      if (error) throw error;

      toast.success("Member removed successfully");
      await loadData();
    } catch (error: any) {
      console.error("Failed to remove member:", error);
      toast.error(error.message || "Failed to remove member");
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!canManageMembers) return;

    try {
      const { error } = await supabase
        .from("organization_invitations")
        .update({ status: "revoked" })
        .eq("id", invitationId);

      if (error) throw error;

      toast.success("Invitation revoked");
      await loadData();
    } catch (error: any) {
      console.error("Failed to revoke invitation:", error);
      toast.error(error.message || "Failed to revoke invitation");
    }
  };

  const handleAddLicenses = async () => {
    if (!orgContext || orgContext.role !== "owner") {
      toast.error("Only the owner can manage licenses");
      return;
    }

    if (!subscription) {
      toast.error("Subscription data not available");
      return;
    }

    // If on Individual plan, prompt to upgrade
    if (subscription.plan_type === "individual") {
      toast.error(
        "You need to upgrade to an Organization plan to add team members. Please go to Billing to upgrade.",
        { duration: 5000 }
      );
      setShowAddLicenseModal(false);
      return;
    }

    // If on Free plan, prompt to select a plan
    if (subscription.plan_type === "free") {
      toast.error(
        "Please select a plan in the Billing section before adding licenses.",
        { duration: 5000 }
      );
      setShowAddLicenseModal(false);
      return;
    }

    // For Organization plan, add licenses via Stripe
    try {
      toast.loading("Adding licenses...");
      
      const result = await addLicenses(additionalLicensesToAdd);
      
      toast.dismiss();
      toast.success(result.message || `Successfully added ${additionalLicensesToAdd} license${additionalLicensesToAdd !== 1 ? "s" : ""}!`);
      
      setAdditionalLicensesToAdd(1);
      setShowAddLicenseModal(false);
      
      // Reload data after a brief delay to allow webhook to process
      setTimeout(() => {
        loadData();
      }, 2000);
    } catch (error: any) {
      console.error("Failed to add licenses:", error);
      toast.dismiss();
      toast.error(error.message || "Failed to add licenses");
    }
  };

  const handleChangeRole = async (memberId: string, currentRole: MemberRole, newRole: MemberRole) => {
    if (!orgContext || orgContext.role !== "owner") {
      toast.error("Only the owner can change member roles");
      return;
    }

    if (currentRole === "owner") {
      toast.error("Cannot change the owner's role");
      return;
    }

    try {
      const { error } = await supabase
        .from("organization_memberships")
        .update({ role: newRole })
        .eq("id", memberId);

      if (error) throw error;

      toast.success("Role updated successfully");
      await loadData();
    } catch (error: any) {
      console.error("Failed to update role:", error);
      toast.error(error.message || "Failed to update role");
    }
  };

  const getRoleIcon = (role: MemberRole) => {
    switch (role) {
      case "owner":
        return <Crown size={16} className="text-yellow-600" />;
      case "super_admin":
        return <Shield size={16} className="text-blue-600" />;
      case "admin":
        return <User size={16} className="text-gray-600" />;
    }
  };

  const getRoleLabel = (role: MemberRole) => {
    switch (role) {
      case "owner":
        return "Owner";
      case "super_admin":
        return "Super Admin";
      case "admin":
        return "Admin";
    }
  };

  const getRoleDescription = (role: MemberRole) => {
    switch (role) {
      case "owner":
        return "Full access to everything including billing";
      case "super_admin":
        return "Full access to projects and price book";
      case "admin":
        return "Can view and edit projects, view-only price book";
    }
  };

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(0)}`;
  };

  // Filter members based on search
  const filteredMembers = members.filter((member) => {
    if (!searchFilter) return true;
    const search = searchFilter.toLowerCase();
    return (
      member.profile.email.toLowerCase().includes(search) ||
      member.profile.full_name?.toLowerCase().includes(search) ||
      getRoleLabel(member.role).toLowerCase().includes(search)
    );
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getInitials = (name: string | null, email: string) => {
    if (name) {
      const parts = name.split(" ");
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return parts[0][0].toUpperCase();
    }
    return email[0].toUpperCase();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Main Members Modal */}
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-white">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Members</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {orgContext?.organization_name || "Business"} · {members.length} member{members.length !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Close members modal"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {loading ? (
              <div className="text-center py-16">
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-gray-900"></div>
                <p className="mt-4 text-sm text-gray-500">Loading members...</p>
              </div>
            ) : (
              <>
                {/* Permissions Notice */}
                {!canManageMembers && (
                  <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-3">
                    <AlertCircle className="text-yellow-600 mt-0.5 flex-shrink-0" size={20} />
                    <div>
                      <p className="text-sm font-medium text-yellow-900">View Only</p>
                      <p className="text-sm text-yellow-700 mt-1">
                        Only owners and super admins can invite and manage members.
                      </p>
                    </div>
                  </div>
                )}

                {/* Search Bar and Actions */}
                <div className="mb-6 flex items-center gap-3">
                  {/* Search Input */}
                  <div className="flex-1 relative">
                    <Search
                      size={18}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                      type="text"
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      placeholder="Filter by name"
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    {canManageMembers && orgContext?.role === "owner" && (
                      <button
                        onClick={() => setShowAddLicenseModal(true)}
                        className="flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-lg transition-colors"
                      >
                        <Plus size={18} />
                        Add license
                      </button>
                    )}
                    <button
                      onClick={() => setShowInviteModal(true)}
                      disabled={!canManageMembers}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                    >
                      <Plus size={18} />
                      Invite member
                    </button>
                  </div>
                </div>

                {/* Members Table */}
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* Table Header */}
                  <div className="bg-gray-50 border-b border-gray-200 px-6 py-3">
                    <div className="grid grid-cols-12 gap-4">
                      <div className="col-span-5 text-xs font-semibold text-gray-700 uppercase tracking-wide">
                        Name
                      </div>
                      <div className="col-span-3 text-xs font-semibold text-gray-700 uppercase tracking-wide">
                        Account type
                      </div>
                      <div className="col-span-3 text-xs font-semibold text-gray-700 uppercase tracking-wide">
                        Date added
                      </div>
                      <div className="col-span-1"></div>
                    </div>
                  </div>

                  {/* Table Body */}
                  <div className="divide-y divide-gray-200 bg-white">
                    {filteredMembers.length === 0 ? (
                      <div className="px-6 py-12 text-center">
                        <p className="text-sm text-gray-500">
                          {searchFilter ? "No members found matching your search" : "No members yet"}
                        </p>
                      </div>
                    ) : (
                      filteredMembers.map((member) => {
                        const initials = getInitials(member.profile.full_name, member.profile.email);
                        const isCurrentUser = member.user_id === currentUserId;

                        return (
                          <div key={member.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                            <div className="grid grid-cols-12 gap-4 items-center">
                              {/* Name Column */}
                              <div className="col-span-5 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold flex-shrink-0">
                                  {initials}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-gray-900 truncate">
                                    {member.profile.full_name || member.profile.email}
                                    {isCurrentUser && (
                                      <span className="ml-2 text-gray-500 font-normal">(You)</span>
                                    )}
                                  </p>
                                  <p className="text-sm text-gray-500 truncate">
                                    {member.profile.email}
                                  </p>
                                </div>
                              </div>

                              {/* Account Type Column */}
                              <div className="col-span-3">
                                <span className="text-sm text-gray-900">
                                  {getRoleLabel(member.role)}
                                </span>
                              </div>

                              {/* Date Added Column */}
                              <div className="col-span-3">
                                <span className="text-sm text-gray-600">
                                  {formatDate(member.created_at)}
                                </span>
                              </div>

                              {/* Actions Column */}
                              <div className="col-span-1 flex justify-end">
                                {canManageMembers && member.role !== "owner" && (
                                  <div className="relative">
                                    <button
                                      onClick={() =>
                                        setOpenMemberMenu(
                                          openMemberMenu === member.id ? null : member.id
                                        )
                                      }
                                      className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                                    >
                                      <MoreVertical size={18} />
                                    </button>

                                    {openMemberMenu === member.id && (
                                      <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                                        <button
                                          onClick={() => {
                                            handleRemoveMember(
                                              member.id,
                                              member.profile.email
                                            );
                                            setOpenMemberMenu(null);
                                          }}
                                          className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 transition-colors"
                                        >
                                          Remove from organization
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Note */}
                <p className="mt-4 text-xs text-gray-500">
                  Note: Although new workspace members can access QuoteTree immediately, it may take
                  up to 24 hours to show them in this list.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Invite Members Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Invite your Team</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Empower everyone to get more deals done—faster.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  setEmailPills([]);
                  setCurrentEmailInput("");
                  setInviteRole("admin");
                }}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-6 space-y-5">
              {/* Email Input with Pills */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                  Add Invitees
                </label>
                <div className="w-full min-h-[100px] px-3 py-2 border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-gray-900 focus-within:border-transparent bg-white">
                  <div className="flex flex-wrap gap-2 items-center">
                    {/* Email Pills */}
                    {emailPills.map((email) => (
                      <div
                        key={email}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-100 text-amber-900 rounded-full text-sm"
                      >
                        <span>{email}</span>
                        <button
                          onClick={() => removeEmailPill(email)}
                          className="hover:bg-amber-200 rounded-full p-0.5 transition-colors"
                          type="button"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    {/* Input Field */}
                    <input
                      type="text"
                      value={currentEmailInput}
                      onChange={(e) => handleEmailInput(e.target.value)}
                      onKeyDown={handleEmailKeyDown}
                      placeholder={emailPills.length === 0 ? "Use commas or spaces to separate email addresses" : ""}
                      className="flex-1 min-w-[200px] border-none outline-none bg-transparent text-sm py-1"
                    />
                  </div>
                </div>
              </div>

              {/* Role Selection */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "super_admin" | "admin")}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
                >
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>

              {/* License Usage */}
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">License Usage</span>
                  <span className="text-2xl font-bold text-gray-900">
                    {orgContext?.available_licenses || 0}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  {orgContext?.used_licenses || 0} of {orgContext?.total_licenses || 0} licenses used
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {orgContext?.available_licenses || 0} available
                </p>

                {/* Warning if no licenses */}
                {orgContext && orgContext.available_licenses === 0 && (
                  <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
                    <AlertCircle size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-yellow-800 font-medium">
                      No licenses available. Go to Billing to add more licenses before inviting
                      members.
                    </p>
                  </div>
                )}
              </div>

              {/* Add License Button */}
              {orgContext?.role === "owner" && (
                <button
                  onClick={() => {
                    setShowInviteModal(false);
                    setShowAddLicenseModal(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition-colors"
                >
                  <Plus size={18} />
                  Add license
                </button>
              )}

              {/* Invite Button */}
              <button
                onClick={handleInviteMembers}
                disabled={
                  inviting ||
                  (emailPills.length === 0 && !currentEmailInput.trim()) ||
                  !orgContext ||
                  orgContext.available_licenses === 0
                }
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 text-gray-700 font-medium rounded-lg transition-colors"
              >
                <Plus size={18} />
                {inviting ? "Inviting..." : "Invite Team Member"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add License Modal */}
      {showAddLicenseModal && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Add Additional Licenses</h3>
              <button
                onClick={() => {
                  setShowAddLicenseModal(false);
                  setAdditionalLicensesToAdd(1);
                }}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-6 space-y-5">
              {subscription && subscription.plan_type === "individual" ? (
                <>
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-900">
                      <strong>Upgrade Required</strong>
                    </p>
                    <p className="text-sm text-blue-800 mt-2">
                      You're currently on an Individual plan. To add team members, you need to
                      upgrade to an Organization plan.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowAddLicenseModal(false);
                      toast("Please go to Billing to upgrade to an Organization plan", {
                        duration: 4000,
                        icon: "ℹ️",
                      });
                    }}
                    className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-lg transition-colors"
                  >
                    Go to Billing
                  </button>
                </>
              ) : subscription && subscription.plan_type === "organization" ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      Number of licenses to add
                    </label>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() =>
                          setAdditionalLicensesToAdd(Math.max(1, additionalLicensesToAdd - 1))
                        }
                        className="w-10 h-10 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded-lg text-gray-700 font-bold transition-colors"
                      >
                        -
                      </button>
                      <span className="flex-1 text-center text-2xl font-bold text-gray-900">
                        {additionalLicensesToAdd}
                      </span>
                      <button
                        onClick={() => setAdditionalLicensesToAdd(additionalLicensesToAdd + 1)}
                        className="w-10 h-10 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded-lg text-gray-700 font-bold transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Pricing Info */}
                  <div className="p-4 bg-gray-50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">
                        {additionalLicensesToAdd} license
                        {additionalLicensesToAdd !== 1 ? "s" : ""} ×{" "}
                        {formatCurrency(
                          PLAN_PRICING.organization[subscription.billing_cycle || "yearly"]
                            .perAdditionalLicense
                        )}
                        /mo
                      </span>
                      <span className="font-semibold text-gray-900">
                        {formatCurrency(
                          PLAN_PRICING.organization[subscription.billing_cycle || "yearly"]
                            .perAdditionalLicense * additionalLicensesToAdd
                        )}
                        /mo
                      </span>
                    </div>
                    <div className="pt-2 border-t border-gray-200">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">New Monthly Total</span>
                        <span className="text-lg font-bold text-gray-900">
                          {formatCurrency(
                            PLAN_PRICING.organization[subscription.billing_cycle || "yearly"].base +
                              (subscription.additional_licenses + additionalLicensesToAdd) *
                                PLAN_PRICING.organization[subscription.billing_cycle || "yearly"]
                                  .perAdditionalLicense
                          )}
                          /mo
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleAddLicenses}
                    className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
                  >
                    Add License{additionalLicensesToAdd !== 1 ? "s" : ""}
                  </button>

                  <p className="text-xs text-gray-500 text-center">
                    You'll be charged prorated amount immediately
                  </p>
                </>
              ) : (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-900">
                    Please select a plan in the Billing section first.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

