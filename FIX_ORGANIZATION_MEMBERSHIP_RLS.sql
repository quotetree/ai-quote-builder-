-- ============================================
-- FIX: Organization Membership Circular RLS Issue
-- ============================================
-- Problem: The current RLS policy checks if user is in organization_memberships
-- by querying organization_memberships, creating a circular dependency.
-- Solution: Add a simple policy that lets users ALWAYS read their own membership row.

-- Drop the circular policy
DROP POLICY IF EXISTS "Users can view memberships in their organizations" ON organization_memberships;

-- Create two policies instead:
-- 1. Users can ALWAYS view their own membership
CREATE POLICY "Users can view own membership"
  ON organization_memberships FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 2. Users can view other memberships in their orgs (relies on policy #1)
CREATE POLICY "Users can view org members"
  ON organization_memberships FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- VERIFICATION
-- ============================================

-- Test 1: Can you read your own membership?
SELECT 
  'Own Membership Test' as test_name,
  CASE 
    WHEN EXISTS(SELECT 1 FROM organization_memberships WHERE user_id = auth.uid())
    THEN '✅ PASS - Can read own membership'
    ELSE '❌ FAIL - Cannot read own membership' 
  END as result;

-- Test 2: Show your membership details
SELECT 
  om.id,
  om.organization_id,
  om.user_id,
  om.role,
  o.name as organization_name
FROM organization_memberships om
JOIN organizations o ON om.organization_id = o.id
WHERE om.user_id = auth.uid();

-- Test 3: Show your subscription
SELECT 
  s.id,
  s.organization_id,
  s.plan_type,
  s.status,
  s.trial_end_date,
  s.total_licenses
FROM subscriptions s
WHERE s.organization_id IN (
  SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid()
);

-- ============================================
-- If you still see issues, run this to check data exists:
-- ============================================

-- Check if membership record exists
SELECT 
  'Data Check: Membership' as check_type,
  COUNT(*) as count,
  jsonb_agg(jsonb_build_object(
    'organization_id', organization_id,
    'role', role,
    'joined_at', joined_at
  )) as data
FROM organization_memberships
WHERE user_id = auth.uid();

-- Check if organization record exists
SELECT 
  'Data Check: Organization' as check_type,
  COUNT(*) as count,
  jsonb_agg(jsonb_build_object(
    'id', id,
    'name', name,
    'owner_id', owner_id
  )) as data
FROM organizations
WHERE owner_id = auth.uid()
   OR id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid());

