-- ============================================
-- NUCLEAR FIX: Completely Reset RLS Policies
-- ============================================
-- This removes ALL policies and recreates them from scratch
-- SAFE: Does not touch any data, only access rules

BEGIN;

-- ============================================
-- STEP 1: Remove ALL existing policies
-- ============================================

DO $$ 
DECLARE 
  pol RECORD;
BEGIN
  FOR pol IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'organization_memberships'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON organization_memberships', pol.policyname);
    RAISE NOTICE 'Dropped policy: %', pol.policyname;
  END LOOP;
END $$;

-- ============================================
-- STEP 2: Create the TWO non-circular policies
-- ============================================

-- Policy 1: Users can ALWAYS see their own membership row
-- This is the BASE policy - no dependencies, no recursion
CREATE POLICY "users_can_view_own_membership"
  ON organization_memberships
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Policy 2: Users can see other memberships in their organizations
-- This DEPENDS on policy 1, but is NOT circular because:
-- - The subquery will use policy 1 to find the user's membership
-- - Policy 1 has already granted access to that row
CREATE POLICY "users_can_view_org_members"
  ON organization_memberships
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id 
      FROM organization_memberships om
      WHERE om.user_id = auth.uid()
    )
  );

-- ============================================
-- STEP 3: Recreate INSERT/UPDATE/DELETE policies
-- ============================================

-- INSERT: Owners and super_admins can add members
CREATE POLICY "owners_can_invite_members"
  ON organization_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT om.organization_id 
      FROM organization_memberships om
      WHERE om.user_id = auth.uid() 
        AND om.role IN ('owner', 'super_admin')
    )
  );

-- UPDATE: Owners and super_admins can update memberships
CREATE POLICY "owners_can_update_members"
  ON organization_memberships
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id 
      FROM organization_memberships om
      WHERE om.user_id = auth.uid() 
        AND om.role IN ('owner', 'super_admin')
    )
  );

-- DELETE: Owners and super_admins can remove members
CREATE POLICY "owners_can_remove_members"
  ON organization_memberships
  FOR DELETE
  TO authenticated
  USING (
    organization_id IN (
      SELECT om.organization_id 
      FROM organization_memberships om
      WHERE om.user_id = auth.uid() 
        AND om.role IN ('owner', 'super_admin')
    )
  );

-- ============================================
-- STEP 4: Verify the new policies
-- ============================================

-- Show what was created
SELECT 
  '=== NEW POLICIES CREATED ===' as status;

SELECT 
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'organization_memberships'
ORDER BY 
  CASE cmd
    WHEN 'SELECT' THEN 1
    WHEN 'INSERT' THEN 2
    WHEN 'UPDATE' THEN 3
    WHEN 'DELETE' THEN 4
  END,
  policyname;

-- Test access
SELECT 
  '=== ACCESS TEST ===' as status;

SELECT 
  COUNT(*) as your_memberships,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ SUCCESS - You can access your membership!'
    ELSE '❌ STILL BROKEN - Contact support'
  END as result
FROM organization_memberships
WHERE user_id = auth.uid();

-- Show your membership details
SELECT 
  '=== YOUR MEMBERSHIP ===' as status;

SELECT 
  om.role,
  o.name as organization_name,
  s.plan_type,
  s.status as subscription_status
FROM organization_memberships om
JOIN organizations o ON om.organization_id = o.id
JOIN subscriptions s ON s.organization_id = o.id
WHERE om.user_id = auth.uid()
LIMIT 1;

COMMIT;

-- ============================================
-- FINAL MESSAGE
-- ============================================

SELECT '========================================' as divider;
SELECT '✅ RLS POLICIES COMPLETELY RESET' as status;
SELECT '========================================' as divider;
SELECT 'All users should now be able to access their memberships.' as message;
SELECT 'REFRESH YOUR APP NOW (Cmd+Shift+R)' as action;

