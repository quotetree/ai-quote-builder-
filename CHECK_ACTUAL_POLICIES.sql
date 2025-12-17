-- ============================================
-- CHECK: What RLS policies are ACTUALLY active right now?
-- ============================================

-- Show ALL policies on organization_memberships
SELECT 
  '=== CURRENT POLICIES ON organization_memberships ===' as section;

SELECT 
  policyname as policy_name,
  cmd as command,
  permissive,
  roles,
  qual::TEXT as using_clause,
  with_check::TEXT as with_check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'organization_memberships'
ORDER BY cmd, policyname;

-- Check for circular reference in policies
SELECT 
  '=== CHECKING FOR CIRCULAR REFERENCES ===' as section;

SELECT 
  policyname,
  cmd,
  CASE 
    WHEN qual::TEXT LIKE '%organization_memberships%' 
      AND qual::TEXT LIKE '%organization_memberships%' 
      AND cmd = 'SELECT'
    THEN '⚠️ POSSIBLE CIRCULAR REFERENCE'
    ELSE '✅ Looks OK'
  END as circular_check,
  qual::TEXT as policy_definition
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'organization_memberships'
  AND cmd = 'SELECT';

-- Count how many SELECT policies exist
SELECT 
  '=== POLICY COUNT ===' as section;

SELECT 
  COUNT(*) as total_select_policies,
  CASE 
    WHEN COUNT(*) = 0 THEN '❌ NO POLICIES - Everyone blocked!'
    WHEN COUNT(*) = 1 THEN '⚠️ Only 1 policy - might be circular'
    WHEN COUNT(*) = 2 THEN '✅ Should have 2 non-circular policies'
    ELSE '⚠️ More than expected'
  END as status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'organization_memberships'
  AND cmd = 'SELECT';

-- Show what we SHOULD have (for comparison)
SELECT 
  '=== EXPECTED POLICIES ===' as section;

SELECT 'Should have these 2 SELECT policies:' as note
UNION ALL
SELECT '1. allow_users_read_own_memberships: USING (user_id = auth.uid())'
UNION ALL
SELECT '2. allow_users_read_org_memberships: USING (organization_id IN (SELECT ...))'
UNION ALL
SELECT ''
UNION ALL
SELECT 'If you see different policy names or definitions, they need to be fixed!';

