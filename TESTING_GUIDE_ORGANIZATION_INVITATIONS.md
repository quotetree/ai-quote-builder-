# Testing Guide: Organization Invitation & Collaboration Fix

## Overview

This fix addresses two critical issues:
1. **Members not showing up**: When a user accepts an invitation, they weren't appearing in the owner's members list
2. **Project visibility**: Projects created by one member weren't visible to other organization members

## Root Cause

When a new user accepted an invitation and created an account:
- The `handle_new_user()` trigger was creating a NEW organization for them (their own workspace)
- The invitation acceptance flow was also creating a membership in the INVITED organization
- This resulted in users having TWO organization memberships, with their profile pointing to the WRONG one
- Projects were being created in THEIR organization instead of the invited organization

## The Fix

### 1. Updated `handle_new_user()` Trigger
- Now checks for pending invitations BEFORE creating a new organization
- If a pending invitation exists, it creates the membership and updates the profile to use the invited organization
- Only creates a new organization if there are NO pending invitations

### 2. Updated Invitation Acceptance Flow
- Simplified to check if membership already exists (created by trigger)
- Only creates membership manually for existing users who signed up before receiving an invite

### 3. Updated `createProject()` Function
- Now fetches the user's `organization_id` from their `organization_memberships` table
- Ensures projects are always created in the correct organization

## Files Modified

1. **Database Trigger**:
   - `FIX_INVITATION_SIGNUP_FLOW.sql` - New trigger logic

2. **Frontend**:
   - `app/auth/accept-invite/page.tsx` - Updated invitation acceptance logic
   - `hooks/useProjects.ts` - Fixed project creation to use correct organization_id

3. **Cleanup Script**:
   - `CLEANUP_DUPLICATE_ORGANIZATIONS.sql` - Fixes existing affected users

## Testing Steps

### Step 1: Apply Database Changes

```sql
-- Run in Supabase SQL Editor
\i FIX_INVITATION_SIGNUP_FLOW.sql
```

### Step 2: Clean Up Existing Users (If Any)

```sql
-- Run in Supabase SQL Editor
\i CLEANUP_DUPLICATE_ORGANIZATIONS.sql
```

This will:
- Identify users with duplicate organizations
- Move their profile to the correct organization
- Migrate all their projects, products, and quotes
- Delete empty duplicate organizations

### Step 3: Test Invitation Flow (New User)

#### 3.1 Send Invitation
1. Log in as the owner of an organization
2. Open **Members** modal from sidebar
3. Click **"Invite member"**
4. Enter a NEW email address (not an existing user)
5. Select role: **Admin** or **Super Admin**
6. Click **"Invite Team Member"**

#### 3.2 Accept Invitation (New User)
1. Check the invited user's email for invitation
2. Click **"Accept Invitation"** button in email
3. Create password for the new account
4. Click **"Create Account & Join"**
5. Should see success message and redirect to dashboard

#### 3.3 Verify Member Shows Up
1. As the owner, refresh the **Members** modal
2. **Expected**: The new member should appear in the members list immediately
3. **Expected**: License count should update (used_licenses + 1)

### Step 4: Test Project Visibility

#### 4.1 Owner Creates Project
1. As the owner, create a new project
2. Name it "Owner Test Project"
3. Verify it appears in your projects list

#### 4.2 Member Views Projects
1. Log in as the invited member (admin/super_admin)
2. Navigate to dashboard
3. **Expected**: Should see "Owner Test Project" in the projects list
4. Click on the project
5. **Expected**: Should be able to open and view the project

#### 4.3 Member Creates Project
1. As the member, create a new project
2. Name it "Member Test Project"
3. Verify it appears in your projects list

#### 4.4 Owner Views Member's Project
1. Log in as the owner
2. Navigate to dashboard
3. **Expected**: Should see both "Owner Test Project" AND "Member Test Project"
4. Click on "Member Test Project"
5. **Expected**: Should be able to open and view the project

### Step 5: Test Existing User Invitation

#### 5.1 Send Invitation to Existing User
1. Log in as the owner
2. Invite a user who ALREADY has an account
3. Use their existing email address

#### 5.2 Accept Invitation (Existing User)
1. Log in as the existing user
2. Click invitation link from email
3. **Expected**: Should automatically accept and redirect
4. No password creation should be needed

#### 5.3 Verify Multi-Organization Support
1. As the existing user, check that they can still access their own organization
2. Verify they can also access the new organization's projects
3. Check that their profile shows the correct organization context

### Step 6: Verify Price Book Access

#### 6.1 Admin Role (Read-Only)
1. Log in as an admin member
2. Open **Price Book**
3. **Expected**: Can view products
4. **Expected**: CANNOT add/edit/delete products
5. Should see message: "Only owners and super admins can manage the price book"

#### 6.2 Super Admin Role (Full Access)
1. Log in as a super_admin member
2. Open **Price Book**
3. **Expected**: Can view products
4. **Expected**: CAN add/edit/delete products
5. Should have full access

### Step 7: Test Quote Creation & Visibility

#### 7.1 Create Quote as Owner
1. As owner, open a project
2. Create a new quote
3. Add some line items

#### 7.2 View Quote as Member
1. As member (admin or super_admin), open the same project
2. Navigate to **Log** tab
3. **Expected**: Should see the quote created by owner
4. **Expected**: Should be able to view quote details

#### 7.3 Create Quote as Member
1. As member, create a new quote in the project
2. Add some line items

#### 7.4 View Member's Quote as Owner
1. As owner, open the project
2. Navigate to **Log** tab
3. **Expected**: Should see both quotes (owner's and member's)

## Verification Queries

### Check Organization Memberships
```sql
SELECT 
  o.name as organization,
  p.email,
  om.role,
  om.joined_at,
  p.organization_id = om.organization_id as "profile_matches"
FROM organization_memberships om
JOIN profiles p ON p.id = om.user_id
JOIN organizations o ON o.id = om.organization_id
ORDER BY o.name, om.role;
```

### Check for Duplicate Organizations
```sql
-- This should return ZERO rows after the fix
SELECT 
  p.id,
  p.email,
  p.organization_id as profile_org_id,
  om.organization_id as membership_org_id
FROM profiles p
JOIN organization_memberships om ON om.user_id = p.id
WHERE p.organization_id != om.organization_id;
```

### Check Project Visibility
```sql
-- Projects by organization
SELECT 
  o.name as organization,
  p.project_name,
  u.email as created_by,
  p.created_at
FROM projects p
JOIN organizations o ON o.id = p.organization_id
JOIN profiles u ON u.id = p.user_id
ORDER BY o.name, p.created_at DESC;
```

### Check Subscription License Usage
```sql
SELECT 
  o.name as organization,
  s.plan_type,
  s.total_licenses,
  COUNT(om.id) as used_licenses,
  (s.total_licenses - COUNT(om.id)) as available_licenses
FROM organizations o
JOIN subscriptions s ON s.organization_id = o.id
LEFT JOIN organization_memberships om ON om.organization_id = o.id
GROUP BY o.id, o.name, s.plan_type, s.total_licenses;
```

## Expected Behavior After Fix

### ✅ Invitation Flow (New Users)
- User clicks invitation link → sees password creation form
- Creates password → account created + membership created automatically by trigger
- Profile points to invited organization (NOT a new personal organization)
- User appears in members list IMMEDIATELY
- License count updates correctly

### ✅ Invitation Flow (Existing Users)
- User clicks invitation link → membership created manually
- Profile updated to invited organization
- User appears in members list IMMEDIATELY
- Can still access their own organization if needed

### ✅ Project Visibility
- All organization members see ALL projects in the organization
- Owner can see projects created by members
- Members can see projects created by owner
- Members can see projects created by other members

### ✅ Price Book Access
- **Admin**: Read-only access
- **Super Admin**: Full access (create/edit/delete)
- **Owner**: Full access + billing management

### ✅ License Management
- License count accurately reflects current members
- Cannot invite more members than available licenses
- Owner can add licenses as needed

## Rollback Plan

If issues occur, you can rollback by restoring the previous trigger:

```sql
-- Restore old trigger (in supabase/profiles-trigger.sql)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Then re-apply the old version
\i supabase/profiles-trigger.sql
```

## Success Criteria

- [ ] New invited users appear in members list immediately
- [ ] No duplicate organizations created for invited users
- [ ] Projects visible across all organization members
- [ ] Price book permissions work correctly (admin vs super_admin)
- [ ] License count updates correctly
- [ ] No database errors in logs
- [ ] Users can create projects in correct organization
- [ ] Quotes are visible to all organization members

