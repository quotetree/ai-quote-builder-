-- ============================================
-- VERIFY ORG COLLABORATION WORKS AFTER RLS FIX
-- ============================================
-- Run this AFTER applying ENABLE_RLS_FIX.sql
-- This verifies all org collaboration features still work

-- ============================================
-- TEST 1: View Your Organization
-- ============================================
SELECT 
  '1. View Organization' as test,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ PASS - Can view organization'
    ELSE '❌ FAIL - Cannot view organization'
  END as result,
  json_agg(json_build_object(
    'org_id', id,
    'org_name', name,
    'owner_id', owner_id
  )) as data
FROM organizations o
WHERE o.id IN (
  SELECT organization_id FROM organization_memberships
  WHERE user_id = auth.uid()
)
GROUP BY 1;

-- ============================================
-- TEST 2: View Organization Members
-- ============================================
SELECT 
  '2. View Org Members' as test,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ PASS - Can view team members'
    ELSE '❌ FAIL - Cannot view team members'
  END as result,
  COUNT(*) as member_count,
  json_agg(json_build_object(
    'user_id', om.user_id,
    'role', om.role,
    'joined_at', om.joined_at
  )) as members
FROM organization_memberships om
WHERE om.organization_id IN (
  SELECT organization_id FROM organization_memberships
  WHERE user_id = auth.uid()
)
GROUP BY 1;

-- ============================================
-- TEST 3: View Member Profiles
-- ============================================
SELECT 
  '3. View Member Profiles' as test,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ PASS - Can view member profiles'
    ELSE '❌ FAIL - Cannot view profiles'
  END as result,
  json_agg(json_build_object(
    'user_id', p.id,
    'email', p.email,
    'full_name', p.full_name
  )) as profiles
FROM profiles p
WHERE p.id IN (
  SELECT om.user_id 
  FROM organization_memberships om
  WHERE om.organization_id IN (
    SELECT organization_id FROM organization_memberships
    WHERE user_id = auth.uid()
  )
)
GROUP BY 1;

-- ============================================
-- TEST 4: View Subscription/License Info
-- ============================================
SELECT 
  '4. View Subscription' as test,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ PASS - Can view subscription'
    ELSE '❌ FAIL - Cannot view subscription'
  END as result,
  json_agg(json_build_object(
    'plan_type', s.plan_type,
    'status', s.status,
    'total_licenses', s.total_licenses,
    'base_licenses', s.base_licenses,
    'additional_licenses', s.additional_licenses,
    'trial_end', s.trial_end_date
  )) as subscription_data
FROM subscriptions s
WHERE s.organization_id IN (
  SELECT organization_id FROM organization_memberships
  WHERE user_id = auth.uid()
)
GROUP BY 1;

-- ============================================
-- TEST 5: Check License Usage
-- ============================================
SELECT 
  '5. License Usage Check' as test,
  CASE 
    WHEN s.total_licenses >= member_count 
    THEN '✅ PASS - License count valid'
    ELSE '⚠️ WARNING - More members than licenses'
  END as result,
  json_build_object(
    'total_licenses', s.total_licenses,
    'used_licenses', member_count,
    'available_licenses', s.total_licenses - member_count
  ) as license_info
FROM subscriptions s
JOIN (
  SELECT 
    organization_id,
    COUNT(*) as member_count
  FROM organization_memberships
  GROUP BY organization_id
) mc ON s.organization_id = mc.organization_id
WHERE s.organization_id IN (
  SELECT organization_id FROM organization_memberships
  WHERE user_id = auth.uid()
);

-- ============================================
-- TEST 6: Check Your Role Permissions
-- ============================================
SELECT 
  '6. Role Permissions' as test,
  json_build_object(
    'your_role', om.role,
    'can_invite_members', om.role IN ('owner', 'super_admin'),
    'can_manage_pricebook', om.role IN ('owner', 'super_admin'),
    'can_update_subscription', om.role = 'owner'
  ) as permissions
FROM organization_memberships om
WHERE om.user_id = auth.uid();

-- ============================================
-- TEST 7: Test Helper Functions
-- ============================================
SELECT 
  '7. Helper Functions' as test,
  CASE 
    WHEN membership_info IS NOT NULL 
    THEN '✅ PASS - RPC functions work'
    ELSE '❌ FAIL - RPC functions broken'
  END as result,
  membership_info
FROM (
  SELECT to_jsonb(get_user_organization_membership(auth.uid())) as membership_info
) t;

-- ============================================
-- TEST 8: Verify Data Isolation (Security Test)
-- ============================================
-- This should return 0 - you should NOT see other orgs
SELECT 
  '8. Data Isolation Test' as test,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ PASS - Cannot see other organizations'
    ELSE '❌ FAIL - Security breach: Can see other orgs!'
  END as result,
  COUNT(*) as other_orgs_visible
FROM organizations o
WHERE o.id NOT IN (
  SELECT organization_id FROM organization_memberships
  WHERE user_id = auth.uid()
);

-- ============================================
-- SUMMARY
-- ============================================
SELECT 
  '═══════════════════════════════════════' as separator,
  'TEST SUMMARY' as title;

-- Count passing tests
WITH test_results AS (
  SELECT 
    CASE 
      WHEN EXISTS(
        SELECT 1 FROM organizations o
        WHERE o.id IN (
          SELECT organization_id FROM organization_memberships
          WHERE user_id = auth.uid()
        )
      ) THEN 1 ELSE 0 
    END as test1,
    
    CASE 
      WHEN EXISTS(
        SELECT 1 FROM organization_memberships om
        WHERE om.organization_id IN (
          SELECT organization_id FROM organization_memberships
          WHERE user_id = auth.uid()
        )
      ) THEN 1 ELSE 0 
    END as test2,
    
    CASE 
      WHEN EXISTS(
        SELECT 1 FROM subscriptions s
        WHERE s.organization_id IN (
          SELECT organization_id FROM organization_memberships
          WHERE user_id = auth.uid()
        )
      ) THEN 1 ELSE 0 
    END as test3
)
SELECT 
  'Overall Status' as metric,
  CASE 
    WHEN (test1 + test2 + test3) = 3 
    THEN '✅ ALL CRITICAL TESTS PASSED'
    ELSE '❌ SOME TESTS FAILED - Review above'
  END as status
FROM test_results;

-- ============================================
-- TROUBLESHOOTING TIPS
-- ============================================
/*
If tests fail, check:

1. RLS is enabled:
   SELECT tablename, rowsecurity FROM pg_tables 
   WHERE schemaname = 'public' 
   AND tablename IN ('organizations', 'organization_memberships', 'subscriptions', 'profiles');

2. Policies exist:
   SELECT tablename, policyname FROM pg_policies 
   WHERE schemaname = 'public'
   AND tablename IN ('organizations', 'organization_memberships', 'subscriptions', 'profiles');

3. You have org membership:
   SELECT * FROM organization_memberships WHERE user_id = auth.uid();

4. Your organization exists:
   SELECT * FROM organizations WHERE id IN (
     SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid()
   );

5. If you're a new user, you might need to create an organization first through the app.
*/

