-- ============================================
-- VERIFICATION: Check All User Data Integrity
-- ============================================
-- Run this to verify NO data was lost

-- Summary of all data in the system
SELECT '========================================' as section;
SELECT '📊 SYSTEM-WIDE DATA SUMMARY' as title;
SELECT '========================================' as section;

-- Total users
SELECT 
  'Total Registered Users' as metric,
  COUNT(*) as count
FROM auth.users;

-- Total organizations
SELECT 
  'Total Organizations' as metric,
  COUNT(*) as count
FROM organizations;

-- Total memberships
SELECT 
  'Total Memberships' as metric,
  COUNT(*) as count
FROM organization_memberships;

-- Memberships by role
SELECT 
  'Memberships by Role' as metric,
  role,
  COUNT(*) as count
FROM organization_memberships
GROUP BY role
ORDER BY 
  CASE role
    WHEN 'owner' THEN 1
    WHEN 'super_admin' THEN 2
    WHEN 'admin' THEN 3
    ELSE 4
  END;

-- Total subscriptions
SELECT 
  'Total Subscriptions' as metric,
  COUNT(*) as count
FROM subscriptions;

-- Subscriptions by plan and status
SELECT 
  'Subscriptions' as metric,
  plan_type,
  status,
  COUNT(*) as count,
  SUM(total_licenses) as total_licenses
FROM subscriptions
GROUP BY plan_type, status
ORDER BY plan_type, status;

-- ============================================
-- DATA INTEGRITY CHECKS
-- ============================================

SELECT '========================================' as section;
SELECT '🔍 DATA INTEGRITY CHECKS' as title;
SELECT '========================================' as section;

-- Check 1: Organizations without owners
SELECT 
  'Organizations Without Valid Owner' as check_name,
  COUNT(*) as count,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ PASS'
    ELSE '⚠️ NEEDS ATTENTION'
  END as status
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE u.id = o.owner_id
);

-- Check 2: Orphaned memberships
SELECT 
  'Memberships Without Valid Organization' as check_name,
  COUNT(*) as count,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ PASS'
    ELSE '❌ NEEDS CLEANUP'
  END as status
FROM organization_memberships om
WHERE NOT EXISTS (
  SELECT 1 FROM organizations o WHERE o.id = om.organization_id
);

-- Check 3: Memberships without valid users
SELECT 
  'Memberships Without Valid User' as check_name,
  COUNT(*) as count,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ PASS'
    ELSE '❌ NEEDS CLEANUP'
  END as status
FROM organization_memberships om
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE u.id = om.user_id
);

-- Check 4: Organizations without subscriptions
SELECT 
  'Organizations Without Subscription' as check_name,
  COUNT(*) as count,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ PASS'
    ELSE '⚠️ NEEDS ATTENTION'
  END as status
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions s WHERE s.organization_id = o.id
);

-- Check 5: Organizations without any members
SELECT 
  'Organizations Without Members' as check_name,
  COUNT(*) as count,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ PASS'
    ELSE '⚠️ NEEDS ATTENTION'
  END as status
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM organization_memberships om WHERE om.organization_id = o.id
);

-- Check 6: Users without memberships
SELECT 
  'Users Without Any Membership' as check_name,
  COUNT(*) as count,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ PASS'
    ELSE '⚠️ Some users have no organization'
  END as status
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM organization_memberships om WHERE om.user_id = u.id
);

-- ============================================
-- DETAILED USER BREAKDOWN
-- ============================================

SELECT '========================================' as section;
SELECT '👥 USER ACCESS BREAKDOWN' as title;
SELECT '========================================' as section;

-- Show all users and their organization status
SELECT 
  u.email,
  u.created_at as user_created,
  COALESCE(om.role, 'NO MEMBERSHIP') as role,
  COALESCE(o.name, 'NO ORG') as organization,
  COALESCE(s.plan_type, 'NO PLAN') as plan,
  COALESCE(s.status, 'NO STATUS') as subscription_status,
  CASE 
    WHEN om.id IS NOT NULL THEN '✅ Has Access'
    ELSE '❌ LOCKED OUT'
  END as access_status
FROM auth.users u
LEFT JOIN organization_memberships om ON om.user_id = u.id
LEFT JOIN organizations o ON o.id = om.organization_id
LEFT JOIN subscriptions s ON s.organization_id = o.id
ORDER BY u.created_at DESC;

-- ============================================
-- INDIVIDUAL PLAN USERS CHECK
-- ============================================

SELECT '========================================' as section;
SELECT '💼 INDIVIDUAL PLAN USERS' as title;
SELECT '========================================' as section;

SELECT 
  u.email,
  om.role,
  o.name as organization,
  s.plan_type,
  s.status,
  s.total_licenses,
  CASE 
    WHEN s.trial_end_date > NOW() THEN 'Trial Active'
    WHEN s.trial_end_date IS NOT NULL AND s.trial_end_date <= NOW() THEN 'Trial Expired'
    ELSE 'No Trial'
  END as trial_status
FROM subscriptions s
JOIN organizations o ON o.id = s.organization_id
JOIN organization_memberships om ON om.organization_id = o.id
JOIN auth.users u ON u.id = om.user_id
WHERE s.plan_type = 'individual'
ORDER BY u.email;

-- ============================================
-- FINAL SUMMARY
-- ============================================

SELECT '========================================' as section;
SELECT '📋 FINAL SUMMARY' as title;
SELECT '========================================' as section;

WITH stats AS (
  SELECT 
    (SELECT COUNT(*) FROM auth.users) as total_users,
    (SELECT COUNT(*) FROM organization_memberships) as total_memberships,
    (SELECT COUNT(DISTINCT user_id) FROM organization_memberships) as users_with_membership,
    (SELECT COUNT(*) FROM organizations) as total_orgs,
    (SELECT COUNT(*) FROM subscriptions) as total_subscriptions
)
SELECT 
  total_users as "Total Users",
  users_with_membership as "Users with Membership",
  (total_users - users_with_membership) as "Users WITHOUT Membership",
  total_orgs as "Total Organizations",
  total_subscriptions as "Total Subscriptions",
  CASE 
    WHEN total_users = users_with_membership THEN '✅ All users have access'
    ELSE '⚠️ ' || (total_users - users_with_membership)::TEXT || ' users need setup'
  END as "Status"
FROM stats;

