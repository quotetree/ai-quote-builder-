-- ============================================
-- CRITICAL FIX: Enable RLS on Tables with Policies
-- ============================================
-- This fixes the "Policy Exists RLS Disabled" and "RLS Disabled in Public" errors
-- Run this in your Supabase SQL Editor

-- Enable RLS on the three affected tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;

-- ============================================
-- ENSURE CRITICAL POLICIES EXIST
-- ============================================

-- Profiles: Allow viewing all profiles (needed for team member listing)
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;
CREATE POLICY "Users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- Profiles: Allow users to update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- Organizations: Allow creating organizations (for new signups)
DROP POLICY IF EXISTS "Users can create organizations" ON organizations;
CREATE POLICY "Users can create organizations"
  ON organizations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- Organization Memberships: Allow self-joining via invitation
-- (This might be needed for invitation acceptance flow)
DROP POLICY IF EXISTS "Users can join with valid invitation" ON organization_memberships;
CREATE POLICY "Users can join with valid invitation"
  ON organization_memberships FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND (
      -- Either they're being added by an admin (covered by other policy)
      -- OR they're accepting an invitation (handled by backend with elevated privileges)
      organization_id IN (
        SELECT organization_id FROM organization_memberships
        WHERE user_id = auth.uid() AND role IN ('owner', 'super_admin')
      )
    )
  );

-- Subscriptions: Allow owners to create initial subscription
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
-- VERIFICATION QUERIES
-- ============================================

-- Check RLS is now enabled
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'organizations', 'organization_memberships')
ORDER BY tablename;

-- Expected output:
-- All three tables should show rls_enabled = true

-- ============================================
-- VERIFY POLICIES EXIST AND ARE ACTIVE
-- ============================================

SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual IS NOT NULL as has_using,
  with_check IS NOT NULL as has_with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'organizations', 'organization_memberships')
ORDER BY tablename, policyname;

-- This should show all your RLS policies for these tables

-- ============================================
-- TEST ACCESS (Run as authenticated user)
-- ============================================

-- Test 1: Can you read your own profile?
SELECT 
  'Profile Access Test' as test_name,
  CASE 
    WHEN EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid()) 
    THEN '✅ PASS - Can read own profile'
    ELSE '❌ FAIL - Cannot read own profile' 
  END as result;

-- Test 2: Can you read your organization?
SELECT 
  'Organization Access Test' as test_name,
  CASE 
    WHEN EXISTS(
      SELECT 1 FROM organizations o
      JOIN organization_memberships om ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
    THEN '✅ PASS - Can read organization'
    ELSE '⚠️ WARNING - No organization found (may be expected for new users)' 
  END as result;

-- Test 3: Can you read your membership?
SELECT 
  'Membership Access Test' as test_name,
  CASE 
    WHEN EXISTS(SELECT 1 FROM organization_memberships WHERE user_id = auth.uid())
    THEN '✅ PASS - Can read membership'
    ELSE '⚠️ WARNING - No membership found (may be expected for new users)' 
  END as result;

-- ============================================
-- IMPORTANT NOTES
-- ============================================

-- 1. RLS is now enabled - policies will be enforced
-- 2. Run the verification queries to confirm everything works
-- 3. If tests fail, check that:
--    a) You're running as an authenticated user
--    b) Your user has the necessary data in these tables
--    c) The policies match your access patterns

-- 4. The existing policies from your migrations should now be active:
--    - profiles: Users can view/update their own profile + view all profiles
--    - organizations: Users can view orgs they're members of
--    - organization_memberships: Users can view memberships in their orgs

