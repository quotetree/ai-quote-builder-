# Organization Plan Permissions - Testing Guide

## Overview
Role-based access control has been implemented for organization settings sections:
- **Owner**: Full access to all sections (Personalization, Members, Billing)
- **Super Admin**: Access to Personalization and Members, NO access to Billing
- **Admin**: NO access to any sections

## What Was Implemented

### 1. New Hook: `useOrganizationRole`
Location: `hooks/useOrganizationRole.ts`

This hook provides:
- Fetches user's role from `organization_memberships` table
- Permission helper functions:
  - `canViewBilling()` - returns true only for owners
  - `canViewMembers()` - returns true for owners and super_admins
  - `canViewPersonalization()` - returns true for owners and super_admins
  - Role check helpers: `isOwner()`, `isSuperAdmin()`, `isAdmin()`

### 2. Updated Components

#### NewSidebar (`components/NewSidebar.tsx`)
- Imports and uses `useOrganizationRole` hook
- Conditionally renders menu items in the account menu dropdown:
  - Personalization button: Only visible to owners and super_admins
  - Members button: Only visible to owners and super_admins  
  - Billing button: Only visible to owners

#### PersonalizationModal (`components/PersonalizationModal.tsx`)
- Added permission guard using `canViewPersonalization()`
- Shows "Access Denied" message if user is an admin
- Message: "You don't have permission to access personalization settings. Contact your organization owner or super admin for access."

#### MembersModal (`components/MembersModal.tsx`)
- Added permission guard using `canViewMembers()`
- Shows "Access Denied" message if user is an admin
- Message: "You don't have permission to access members management. Contact your organization owner or super admin for access."

#### BillingModal (`components/BillingModal.tsx`)
- Added permission guard using `canViewBilling()`
- Shows "Access Denied" message if user is super_admin or admin
- Message: "You don't have permission to access billing settings. Only organization owners can manage billing and subscriptions."

## Testing Instructions

### Prerequisites
You need test users with different roles in your organization to test this properly.

### Test Scenario 1: Owner Role
**Expected Behavior:**
1. Click the user avatar in the sidebar
2. Account menu should show ALL three options:
   - ✅ Personalization
   - ✅ Members
   - ✅ Billing
3. All three modals should open and function normally

### Test Scenario 2: Super Admin Role
**Expected Behavior:**
1. Click the user avatar in the sidebar
2. Account menu should show ONLY two options:
   - ✅ Personalization
   - ✅ Members
   - ❌ Billing (should NOT appear)
3. Personalization and Members modals should work normally
4. If somehow accessing Billing modal directly, should see "Access Denied" message

### Test Scenario 3: Admin Role
**Expected Behavior:**
1. Click the user avatar in the sidebar
2. Account menu should show NO settings options:
   - ❌ Personalization (should NOT appear)
   - ❌ Members (should NOT appear)
   - ❌ Billing (should NOT appear)
3. Only "Sign Out" button should be visible in the account menu
4. If somehow accessing any modal directly, should see "Access Denied" message

### How to Create Test Users
To properly test, you need to:
1. Create test accounts with different emails
2. Invite them to your organization with specific roles
3. Log in as each user and verify the permissions

### Database Verification
Check the `organization_memberships` table to verify roles:
```sql
SELECT 
  om.user_id,
  p.email,
  om.role,
  o.name as organization_name
FROM organization_memberships om
JOIN profiles p ON p.id = om.user_id
JOIN organizations o ON o.id = om.organization_id
WHERE om.organization_id = 'YOUR_ORG_ID';
```

## Edge Cases Covered

1. **User not in any organization**: Role will be `null`, all permissions will return `false`
2. **Direct URL access**: Even if someone tries to directly open modals, permission guards prevent access
3. **Loading state**: Hook has a loading state to prevent flash of incorrect permissions
4. **Error handling**: If query fails, permissions default to denied (fail-safe)

## Files Changed
- ✅ `hooks/useOrganizationRole.ts` (NEW)
- ✅ `components/NewSidebar.tsx` 
- ✅ `components/PersonalizationModal.tsx`
- ✅ `components/MembersModal.tsx`
- ✅ `components/BillingModal.tsx`

## Git Branch
All changes are on the `feature/org-plan-permissions` branch.

## Next Steps
1. Manual testing with real users of different roles
2. Consider adding automated tests for permission helpers
3. Consider adding server-side API route protection for billing/member operations
4. Update onboarding documentation to explain role permissions

