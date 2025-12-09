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
      const { data, error } = await supabase
        .from("organization_memberships")
        .select("role, organization_id")
        .eq("user_id", user.id)
        .single();

      if (error) {
        // If user is not part of any organization yet, that's ok
        if (error.code === 'PGRST116') {
          setRole(null);
          setOrganizationId(null);
        } else {
          throw error;
        }
      } else {
        setRole(data.role as MemberRole);
        setOrganizationId(data.organization_id);
      }
    } catch (err: any) {
      setError(err.message);
      setRole(null);
      setOrganizationId(null);
    } finally {
      setLoading(false);
    }
  }

  // Permission helper functions
  const canViewBilling = (): boolean => {
    // Only owners can view billing
    return role === 'owner';
  };

  const canViewMembers = (): boolean => {
    // Owners and super_admins can view members
    return role === 'owner' || role === 'super_admin';
  };

  const canViewPersonalization = (): boolean => {
    // Owners and super_admins can view personalization
    return role === 'owner' || role === 'super_admin';
  };

  const canManagePriceBook = (): boolean => {
    // Only owners and super_admins can create/edit/delete products
    // Admins have read-only access
    return role === 'owner' || role === 'super_admin';
  };

  const canManageMembers = (): boolean => {
    // Only owners and super_admins can manage members
    return role === 'owner' || role === 'super_admin';
  };

  const canManageBilling = (): boolean => {
    // Only owners can manage billing
    return role === 'owner';
  };

  const canManagePersonalization = (): boolean => {
    // Only owners and super_admins can manage personalization
    return role === 'owner' || role === 'super_admin';
  };

  const isOwner = (): boolean => {
    return role === 'owner';
  };

  const isSuperAdmin = (): boolean => {
    return role === 'super_admin';
  };

  const isAdmin = (): boolean => {
    return role === 'admin';
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
    isOwner,
    isSuperAdmin,
    isAdmin,
  };
}


