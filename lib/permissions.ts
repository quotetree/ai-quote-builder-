/**
 * Permission and role management utilities for QuoteTree workspace
 */

import { MemberRole, PlanType } from "@/types/database";

/**
 * Check if a role can manage the price book (add/edit/delete products)
 */
export function canManagePriceBook(role: MemberRole): boolean {
  return role === "owner" || role === "super_admin";
}

/**
 * Check if a role can view the price book (read-only)
 */
export function canViewPriceBook(role: MemberRole): boolean {
  return true; // All roles can view the price book
}

/**
 * Check if a role can invite and manage team members
 */
export function canManageMembers(role: MemberRole): boolean {
  return role === "owner" || role === "super_admin";
}

/**
 * Check if a role can manage billing and subscriptions
 */
export function canManageBilling(role: MemberRole): boolean {
  return role === "owner"; // Only owners can manage billing
}

/**
 * Check if a role can create/edit/delete projects
 */
export function canManageProjects(role: MemberRole): boolean {
  return true; // All roles can manage projects
}

/**
 * Check if a role can view projects
 */
export function canViewProjects(role: MemberRole): boolean {
  return true; // All roles can view projects
}

/**
 * Check if a role can change another member's role
 */
export function canChangeRole(userRole: MemberRole, targetRole: MemberRole): boolean {
  // Only owners can change roles
  if (userRole !== "owner") return false;
  
  // Cannot change the owner's role
  if (targetRole === "owner") return false;
  
  return true;
}

/**
 * Check if a role can remove another member
 */
export function canRemoveMember(userRole: MemberRole, targetRole: MemberRole): boolean {
  // Owners and super admins can remove members
  if (userRole !== "owner" && userRole !== "super_admin") return false;
  
  // Cannot remove the owner
  if (targetRole === "owner") return false;
  
  return true;
}

/**
 * Get human-readable role label
 */
export function getRoleLabel(role: MemberRole): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "super_admin":
      return "Super Admin";
    case "admin":
      return "Admin";
  }
}

/**
 * Get role description
 */
export function getRoleDescription(role: MemberRole): string {
  switch (role) {
    case "owner":
      return "Created the account and pays the bill. Has full access to add products to price book and add/edit projects.";
    case "super_admin":
      return "Has full access to add products to price book and add/edit projects.";
    case "admin":
      return "Can view projects, edit, and add new projects. View-only access to price book.";
  }
}

/**
 * Get plan display name
 */
export function getPlanDisplayName(planType: PlanType): string {
  switch (planType) {
    case "free":
      return "Free Trial";
    case "individual":
      return "Individual";
    case "organization":
      return "Organization";
  }
}

/**
 * Get plan description
 */
export function getPlanDescription(planType: PlanType): string {
  switch (planType) {
    case "free":
      return "14-day trial with full access to all features";
    case "individual":
      return "For solo professionals";
    case "organization":
      return "For teams & collaboration";
  }
}

/**
 * Check if a plan allows multiple team members
 */
export function allowsMultipleMembers(planType: PlanType): boolean {
  return planType === "organization";
}

/**
 * Get base license count for a plan
 */
export function getBaseLicenseCount(planType: PlanType): number {
  switch (planType) {
    case "free":
      return 1;
    case "individual":
      return 1;
    case "organization":
      return 3;
  }
}

/**
 * Format days remaining in trial
 */
export function formatTrialDaysRemaining(trialEndDate: string | null): string | null {
  if (!trialEndDate) return null;
  
  const endDate = new Date(trialEndDate);
  const now = new Date();
  const diffTime = endDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays <= 0) return "Trial expired";
  if (diffDays === 1) return "1 day remaining";
  return `${diffDays} days remaining`;
}

/**
 * Check if trial is expired
 */
export function isTrialExpired(trialEndDate: string | null): boolean {
  if (!trialEndDate) return false;
  
  const endDate = new Date(trialEndDate);
  const now = new Date();
  
  return now > endDate;
}

/**
 * Check if a plan can be downgraded to based on current member count
 */
export function canDowngradeTo(
  targetPlan: PlanType,
  currentMemberCount: number
): { allowed: boolean; reason?: string } {
  const targetLicenses = getBaseLicenseCount(targetPlan);
  
  if (currentMemberCount > targetLicenses) {
    return {
      allowed: false,
      reason: `Cannot downgrade: You have ${currentMemberCount} members but ${getPlanDisplayName(targetPlan)} only includes ${targetLicenses} license${targetLicenses !== 1 ? "s" : ""}.`,
    };
  }
  
  return { allowed: true };
}

