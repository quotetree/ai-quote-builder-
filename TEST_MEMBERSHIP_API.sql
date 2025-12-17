-- ============================================
-- TEST: What does the API actually return?
-- ============================================
-- Run this as the locked-out user to see what data they can access

-- Test 1: Can you read your own membership?
SELECT 
  '=== TEST 1: Your Membership ===' as test;

SELECT 
  om.id as membership_id,
  om.organization_id,
  om.role,
  om.user_id,
  'You are user: ' || auth.uid()::TEXT as your_user_id,
  CASE 
    WHEN om.user_id = auth.uid() THEN '✅ This is YOUR membership'
    ELSE '⚠️ Not your membership'
  END as check
FROM organization_memberships om
WHERE om.user_id = auth.uid();

-- If this returns EMPTY, the RLS policy is still blocking!

-- Test 2: Check the actual RLS policies
SELECT 
  '=== TEST 2: Current RLS Policies ===' as test;

SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  SUBSTRING(qual::TEXT, 1, 100) as using_clause_preview,
  SUBSTRING(with_check::TEXT, 1, 100) as with_check_preview
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'organization_memberships'
  AND cmd = 'SELECT'
ORDER BY policyname;

-- Test 3: Can you access the helper function?
SELECT 
  '=== TEST 3: Helper Function ===' as test;

SELECT * FROM get_user_organization_membership(auth.uid());

-- If this fails, the function might have an issue

-- Test 4: Raw access test (what policies allow)
SELECT 
  '=== TEST 4: What CAN you see? ===' as test;

-- Try to select from organization_memberships
SELECT 
  COUNT(*) as memberships_you_can_see,
  CASE 
    WHEN COUNT(*) = 0 THEN '❌ PROBLEM: RLS is blocking all access'
    WHEN COUNT(*) = 1 THEN '✅ GOOD: Can see your own membership'
    WHEN COUNT(*) > 1 THEN '✅ GOOD: Can see ' || COUNT(*)::TEXT || ' memberships'
  END as status
FROM organization_memberships;

-- Test 5: Detailed membership check with RLS bypass
SELECT 
  '=== TEST 5: Is RLS even enabled? ===' as test;

SELECT 
  tablename,
  rowsecurity as rls_enabled,
  CASE 
    WHEN rowsecurity THEN '✅ RLS is ON'
    ELSE '❌ RLS is OFF (this would be a problem)'
  END as status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'organization_memberships';

