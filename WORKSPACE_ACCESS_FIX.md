# Workspace Access Fix - Locked Out Issue

## Problem
After creating a free trial account and running RLS troubleshooting, you're locked out of workspace settings (Personalization, Members, Billing show "Owner access only").

## Root Cause
The RLS (Row Level Security) policy for `organization_memberships` has a circular dependency that prevents the frontend from reading your membership role, which makes it think you're not an owner.

## Solution - Apply These Fixes in Order

### Step 1: Fix the Circular RLS Policy

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Copy and paste the contents of `FIX_ORGANIZATION_MEMBERSHIP_RLS.sql`
4. Click **Run**
5. Check the verification output:
   - ✅ Should show "Can read own membership"
   - Should display your membership with role='owner'
   - Should show your subscription

### Step 2: If Step 1 Shows "Cannot read own membership"

This means your account is missing the organization/membership record entirely.

1. In the SQL Editor, run `CREATE_MISSING_MEMBERSHIP.sql`
2. Check the output - it will:
   - Create your organization if missing
   - Create your membership with role='owner' if missing
   - Create your trial subscription if missing
3. Verify the final output shows:
   - ✅ Organization exists
   - ✅ Membership exists with role='owner'
   - ✅ Subscription exists

### Step 3: Refresh Your App

1. Go back to your QuoteTree app
2. **Hard refresh** the page (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)
3. The `useOrganizationRole` hook should now correctly detect you as 'owner'
4. Workspace settings should be unlocked

## How to Verify It's Fixed

1. Click on your account menu in the sidebar
2. You should now see:
   - **Personalization** - clickable (no lock)
   - **Members** - clickable (no lock)
   - **Billing** - clickable (no lock)
3. Try clicking on each - they should open their respective modals

## What Was Fixed

### The Circular RLS Problem
The original policy was:
```sql
CREATE POLICY "Users can view memberships in their organizations"
  ON organization_memberships FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships  -- ❌ Circular!
      WHERE user_id = auth.uid()
    )
  );
```

This queries `organization_memberships` from within its own RLS policy, creating a chicken-and-egg problem.

### The Fix
We split it into two policies:
```sql
-- Policy 1: Always allow viewing own row (no dependencies)
CREATE POLICY "Users can view own membership"
  ON organization_memberships FOR SELECT
  USING (user_id = auth.uid());

-- Policy 2: View other members (depends on policy 1)
CREATE POLICY "Users can view org members"
  ON organization_memberships FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );
```

## If You Still Have Issues

Run this query in Supabase SQL Editor to debug:
```sql
-- Check your auth status
SELECT auth.uid() as your_user_id, email FROM auth.users WHERE id = auth.uid();

-- Check your membership
SELECT 
  om.id,
  om.role,
  om.organization_id,
  o.name as org_name
FROM organization_memberships om
JOIN organizations o ON om.organization_id = o.id
WHERE om.user_id = auth.uid();
```

If this returns empty, run `CREATE_MISSING_MEMBERSHIP.sql` again.

## Prevention

This issue was caused by:
1. RLS policies with circular dependencies
2. The `handle_new_user()` trigger might not have fired when you signed up

The fix ensures:
1. RLS policies are non-circular
2. Missing organization/membership records are created
3. Trial subscription is properly set up

## What You Should See After Fix

In your app's browser console (F12), you should see:
```
[useOrganizationRole] role: owner org: <uuid>
[useOrganizationRole] flags: { isOwner: true, isSuperAdmin: false, isAdmin: false }
```

This confirms the hook is correctly reading your role.

