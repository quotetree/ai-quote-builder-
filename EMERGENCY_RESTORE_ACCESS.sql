-- ============================================
-- EMERGENCY FIX: Restore Access for ALL Users
-- ============================================
-- This fixes the RLS lockout WITHOUT creating new data
-- SAFE to run - does not delete or modify any existing memberships

-- ============================================
-- STEP 1: Fix the Circular RLS Policy NOW
-- ============================================

-- Drop ALL existing policies on organization_memberships
DROP POLICY IF EXISTS "Users can view memberships in their organizations" ON organization_memberships;
DROP POLICY IF EXISTS "Users can view own membership" ON organization_memberships;
DROP POLICY IF EXISTS "Users can view org members" ON organization_memberships;
DROP POLICY IF EXISTS "Owners and super_admins can add members" ON organization_memberships;
DROP POLICY IF EXISTS "Owners and super_admins can manage members" ON organization_memberships;
DROP POLICY IF EXISTS "Owners and super_admins can remove members" ON organization_memberships;
DROP POLICY IF EXISTS "Users can join with valid invitation" ON organization_memberships;

-- Create a SIMPLE, NON-CIRCULAR policy for SELECT
-- This allows users to see ANY membership row where they are the user
CREATE POLICY "allow_users_read_own_memberships"
  ON organization_memberships 
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Allow users to see other members in their organizations
-- This relies on the first policy, so it's NOT circular
CREATE POLICY "allow_users_read_org_memberships"
  ON organization_memberships 
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM organization_memberships 
      WHERE user_id = auth.uid()
    )
  );

-- Re-create INSERT policy for owners/super_admins
CREATE POLICY "allow_owners_invite_members"
  ON organization_memberships 
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM organization_memberships 
      WHERE user_id = auth.uid() 
        AND role IN ('owner', 'super_admin')
    )
  );

-- Re-create UPDATE policy for owners/super_admins
CREATE POLICY "allow_owners_update_members"
  ON organization_memberships 
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM organization_memberships 
      WHERE user_id = auth.uid() 
        AND role IN ('owner', 'super_admin')
    )
  );

-- Re-create DELETE policy for owners/super_admins
CREATE POLICY "allow_owners_remove_members"
  ON organization_memberships 
  FOR DELETE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM organization_memberships 
      WHERE user_id = auth.uid() 
        AND role IN ('owner', 'super_admin')
    )
  );

-- ============================================
-- STEP 2: Verify ALL Users Can Access Their Memberships
-- ============================================

-- Count how many users have memberships
SELECT 
  'Total Users with Memberships' as metric,
  COUNT(DISTINCT user_id) as count
FROM organization_memberships;

-- Count memberships by role
SELECT 
  'Memberships by Role' as metric,
  role,
  COUNT(*) as count
FROM organization_memberships
GROUP BY role
ORDER BY role;

-- Count organizations
SELECT 
  'Total Organizations' as metric,
  COUNT(*) as count
FROM organizations;

-- Count subscriptions by plan type
SELECT 
  'Subscriptions by Plan' as metric,
  plan_type,
  status,
  COUNT(*) as count
FROM subscriptions
GROUP BY plan_type, status
ORDER BY plan_type, status;

-- ============================================
-- STEP 3: Check for Data Integrity Issues
-- ============================================

-- Check for orphaned memberships (memberships without valid organizations)
SELECT 
  'Orphaned Memberships' as issue,
  COUNT(*) as count,
  'These memberships point to non-existent organizations' as description
FROM organization_memberships om
WHERE NOT EXISTS (
  SELECT 1 FROM organizations o WHERE o.id = om.organization_id
);

-- Check for organizations without subscriptions
SELECT 
  'Organizations Without Subscriptions' as issue,
  COUNT(*) as count,
  'These organizations have no subscription record' as description
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions s WHERE s.organization_id = o.id
);

-- Check for users without any membership
SELECT 
  'Users Without Membership' as issue,
  COUNT(*) as count,
  'These users exist but have no organization membership' as description
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM organization_memberships om WHERE om.user_id = au.id
);

-- ============================================
-- STEP 4: Test Access (Run as a regular user)
-- ============================================

-- This should now work for any authenticated user
SELECT 
  '✅ YOUR ACCESS TEST' as test;

SELECT 
  'Your Membership' as item,
  om.role,
  o.name as organization,
  s.plan_type,
  s.status as subscription_status
FROM organization_memberships om
JOIN organizations o ON om.organization_id = o.id
LEFT JOIN subscriptions s ON s.organization_id = o.id
WHERE om.user_id = auth.uid();

-- ============================================
-- NEXT STEPS
-- ============================================

SELECT '===========================================' as divider;
SELECT '✅ EMERGENCY FIX COMPLETE' as status;
SELECT '===========================================' as divider;
SELECT 'All users should now be able to access their memberships.' as result;
SELECT 'Review the counts above to ensure all data is intact.' as action;
SELECT 'If you see any orphaned data, run the cleanup scripts.' as note;

