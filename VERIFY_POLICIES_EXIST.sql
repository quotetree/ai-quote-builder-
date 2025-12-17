-- ============================================
-- VERIFY: Were the policies actually created?
-- ============================================

-- List ALL policies on organization_memberships
SELECT 
  '=== ALL POLICIES ===' as section;

SELECT 
  policyname as name,
  cmd as operation,
  SUBSTRING(qual::TEXT, 1, 200) as using_clause,
  SUBSTRING(with_check::TEXT, 1, 200) as check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'organization_memberships'
ORDER BY cmd, policyname;

-- Count them
SELECT 
  '=== POLICY COUNT ===' as section;

SELECT 
  cmd as operation,
  COUNT(*) as count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'organization_memberships'
GROUP BY cmd
ORDER BY cmd;

-- We should have:
-- SELECT: 2 policies
-- INSERT: 1 policy
-- UPDATE: 1 policy  
-- DELETE: 1 policy

-- ============================================
-- TEST: Can YOU access your membership?
-- ============================================

SELECT 
  '=== DIRECT QUERY TEST ===' as section;

-- Try to query directly
SELECT 
  om.id,
  om.organization_id,
  om.role,
  om.user_id,
  'Your user_id: ' || auth.uid()::TEXT as your_id,
  CASE 
    WHEN om.user_id = auth.uid() THEN '✅ This is YOUR row'
    ELSE '⚠️ Not your row'
  END as check
FROM organization_memberships om
WHERE om.user_id = auth.uid()
LIMIT 1;

-- If this returns EMPTY or ERROR, the policy is still broken!

-- ============================================
-- CHECK: Is there a recursive query issue?
-- ============================================

SELECT 
  '=== CHECKING FOR RECURSION ===' as section;

-- Test if the SELECT policy causes infinite recursion
EXPLAIN (VERBOSE, FORMAT JSON)
SELECT * FROM organization_memberships WHERE user_id = auth.uid();

-- This will show us if the query plan has recursion

