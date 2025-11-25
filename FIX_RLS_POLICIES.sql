-- ============================================
-- FIX: Add Missing RLS Policies for Profiles
-- ============================================

-- Enable RLS on profiles if not already enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all profiles (needed for team member listing)
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;
CREATE POLICY "Users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- Allow users to update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- ============================================
-- FIX: Update Organization Memberships Policies
-- ============================================

-- Allow authenticated users to read organization memberships (needed for joins)
DROP POLICY IF EXISTS "Users can view memberships in their organizations" ON organization_memberships;
CREATE POLICY "Users can view memberships in their organizations"
  ON organization_memberships FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- GRANT Execute Permissions on RPC Functions
-- ============================================

GRANT EXECUTE ON FUNCTION get_user_organization_membership(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_user_manage_pricebook(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_user_invite_members(UUID) TO authenticated;

-- ============================================
-- FIX: Add Missing Subscription INSERT Policy
-- ============================================

DROP POLICY IF EXISTS "Owners can create their subscription" ON subscriptions;
CREATE POLICY "Owners can create their subscription" 
  ON subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ============================================
-- VERIFICATION: Test Everything Works
-- ============================================

-- Test 1: Can you read your profile?
SELECT 'Profile readable' as test, 
  CASE WHEN EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid()) 
  THEN '✅ YES' ELSE '❌ NO' END as result;

-- Test 2: Can you read your organization?
SELECT 'Organization readable' as test,
  CASE WHEN EXISTS(SELECT 1 FROM organizations WHERE owner_id = auth.uid())
  THEN '✅ YES' ELSE '❌ NO' END as result;

-- Test 3: Can you read your membership?
SELECT 'Membership readable' as test,
  CASE WHEN EXISTS(SELECT 1 FROM organization_memberships WHERE user_id = auth.uid())
  THEN '✅ YES' ELSE '❌ NO' END as result;

-- Test 4: Can you call RPC function?
SELECT 'RPC function works' as test,
  CASE WHEN EXISTS(SELECT 1 FROM get_user_organization_membership(auth.uid()))
  THEN '✅ YES' ELSE '❌ NO' END as result;

