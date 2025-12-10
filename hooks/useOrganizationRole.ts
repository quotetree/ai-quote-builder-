import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { MemberRole } from "@/types/database";

interface OrganizationRoleData {
  role: MemberRole | null;
  organizationId: string | null;
  loading: boolean;
  error: string | null;
}

interface PermissionHelpers {
  canViewBilling: () => boolean;
  canViewMembers: () => boolean;
  canViewPersonalization: () => boolean;
  canManagePriceBook: () => boolean;
  canManageMembers: () => boolean;
  canManageBilling: () => boolean;
  canManagePersonalization: () => boolean;
  hasReadOnlyPriceBook: () => boolean;
  isOwner: () => boolean;
  isSuperAdmin: () => boolean;
  isAdmin: () => boolean;
}

export function useOrganizationRole(): OrganizationRoleData & PermissionHelpers {
  const [role, setRole] = useState<MemberRole | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    fetchOrganizationRole();
  }, []);

  async function fetchOrganizationRole() {
    try {
      setLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setRole(null);
        setOrganizationId(null);
        return;
      }

      // Query organization_memberships to get the user's role
      // Handle multiple org memberships by taking the first one
      const { data, error } = await supabase
        .from("organization_memberships")
        .select("role, organization_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        // User is not part of any organization yet
        setRole(null);
        setOrganizationId(null);
      } else {
        const membership = data[0];
        console.log('[useOrganizationRole] role:', membership.role, 'org:', membership.organization_id);
        setRole(membership.role as MemberRole);
        setOrganizationId(membership.organization_id);
      }
    } catch (err: any) {
      setError(err.message);
      setRole(null);
      setOrganizationId(null);
    } finally {
      setLoading(false);
    }
  }

  // Define explicit role flags
  const isOwner = role === 'owner';
  const isSuperAdmin = role === 'super_admin';
  const isAdmin = role === 'admin';

  // Log flags for debugging
  console.log('[useOrganizationRole] flags:', { isOwner, isSuperAdmin, isAdmin });

  // Permission helper functions
  const canViewBilling = (): boolean => {
    // Only owners can view billing
    return isOwner;
  };

  const canViewMembers = (): boolean => {
    // Owners and super_admins can view members
    return isOwner || isSuperAdmin;
  };

  const canViewPersonalization = (): boolean => {
    // Owners and super_admins can view personalization
    return isOwner || isSuperAdmin;
  };

  const canManagePriceBook = (): boolean => {
    // Only owners and super_admins can create/edit/delete products
    // Admins have read-only access
    return isOwner || isSuperAdmin;
  };

  const canManageMembers = (): boolean => {
    // Only owners and super_admins can manage members
    return isOwner || isSuperAdmin;
  };

  const canManageBilling = (): boolean => {
    // Only owners can manage billing
    return isOwner;
  };

  const canManagePersonalization = (): boolean => {
    // Only owners and super_admins can manage personalization
    return isOwner || isSuperAdmin;
  };

  const hasReadOnlyPriceBook = (): boolean => {
    // Admins have read-only access to price book
    return isAdmin && !(isOwner || isSuperAdmin);
  };

  const isOwnerRole = (): boolean => {
    return isOwner;
  };

  const isSuperAdminRole = (): boolean => {
    return isSuperAdmin;
  };

  const isAdminRole = (): boolean => {
    return isAdmin;
  };

  return {
    role,
    organizationId,
    loading,
    error,
    canViewBilling,
    canViewMembers,
    canViewPersonalization,
    canManagePriceBook,
    canManageMembers,
    canManageBilling,
    canManagePersonalization,
    hasReadOnlyPriceBook,
    isOwner: isOwnerRole,
    isSuperAdmin: isSuperAdminRole,
    isAdmin: isAdminRole,
  };
}


