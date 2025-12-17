-- ============================================
-- COMPREHENSIVE DIAGNOSIS - Bypass RLS to See Real Data
-- ============================================
-- This uses admin functions to see the actual data in tables

-- First, let's create a diagnostic function that bypasses RLS
CREATE OR REPLACE FUNCTION diagnose_user_access()
RETURNS TABLE (
  section TEXT,
  detail TEXT,
  value TEXT
) 
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  org_count INT;
  membership_count INT;
  subscription_count INT;
BEGIN
  -- User info
  RETURN QUERY
  SELECT 
    'USER INFO'::TEXT,
    'User ID'::TEXT,
    current_user_id::TEXT;
  
  RETURN QUERY
  SELECT 
    'USER INFO'::TEXT,
    'Email'::TEXT,
    u.email::TEXT
  FROM auth.users u
  WHERE u.id = current_user_id;
  
  -- Count memberships
  SELECT COUNT(*) INTO membership_count
  FROM organization_memberships
  WHERE user_id = current_user_id;
  
  RETURN QUERY
  SELECT 
    'MEMBERSHIP COUNT'::TEXT,
    'Total memberships'::TEXT,
    membership_count::TEXT;
  
  -- Show all memberships (bypassing RLS)
  RETURN QUERY
  SELECT 
    'MEMBERSHIP DETAILS'::TEXT,
    'Membership #' || ROW_NUMBER() OVER ()::TEXT,
    'Org ID: ' || om.organization_id::TEXT || 
    ', Role: ' || om.role || 
    ', Joined: ' || om.joined_at::TEXT
  FROM organization_memberships om
  WHERE om.user_id = current_user_id;
  
  -- Count organizations this user has access to
  SELECT COUNT(*) INTO org_count
  FROM organizations o
  WHERE o.id IN (
    SELECT organization_id FROM organization_memberships WHERE user_id = current_user_id
  );
  
  RETURN QUERY
  SELECT 
    'ORGANIZATION COUNT'::TEXT,
    'Accessible orgs'::TEXT,
    org_count::TEXT;
  
  -- Show all organizations (bypassing RLS)
  RETURN QUERY
  SELECT 
    'ORGANIZATION DETAILS'::TEXT,
    'Org #' || ROW_NUMBER() OVER ()::TEXT,
    'ID: ' || o.id::TEXT || 
    ', Name: ' || o.name || 
    ', Owner: ' || o.owner_id::TEXT ||
    CASE WHEN o.owner_id = current_user_id THEN ' (YOU)' ELSE '' END
  FROM organizations o
  WHERE o.id IN (
    SELECT organization_id FROM organization_memberships WHERE user_id = current_user_id
  );
  
  -- Count subscriptions
  SELECT COUNT(*) INTO subscription_count
  FROM subscriptions s
  WHERE s.organization_id IN (
    SELECT organization_id FROM organization_memberships WHERE user_id = current_user_id
  );
  
  RETURN QUERY
  SELECT 
    'SUBSCRIPTION COUNT'::TEXT,
    'Total subscriptions'::TEXT,
    subscription_count::TEXT;
  
  -- Show all subscriptions
  RETURN QUERY
  SELECT 
    'SUBSCRIPTION DETAILS'::TEXT,
    'Sub #' || ROW_NUMBER() OVER ()::TEXT,
    'Org ID: ' || s.organization_id::TEXT ||
    ', Plan: ' || s.plan_type ||
    ', Status: ' || s.status ||
    ', Licenses: ' || s.total_licenses::TEXT ||
    CASE WHEN s.trial_end_date IS NOT NULL 
      THEN ', Trial Ends: ' || s.trial_end_date::TEXT 
      ELSE '' 
    END
  FROM subscriptions s
  WHERE s.organization_id IN (
    SELECT organization_id FROM organization_memberships WHERE user_id = current_user_id
  );
  
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION diagnose_user_access() TO authenticated;

-- Now run the diagnosis
SELECT * FROM diagnose_user_access();

-- ============================================
-- Additional checks: RLS Policy Status
-- ============================================

SELECT 
  '=== RLS POLICY CHECK ===' as section,
  tablename,
  policyname,
  CASE 
    WHEN cmd = 'SELECT' THEN '✅ SELECT'
    WHEN cmd = 'INSERT' THEN '📝 INSERT'
    WHEN cmd = 'UPDATE' THEN '✏️ UPDATE'
    WHEN cmd = 'DELETE' THEN '🗑️ DELETE'
    ELSE cmd
  END as operation
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('organizations', 'organization_memberships', 'subscriptions')
ORDER BY tablename, cmd;

-- ============================================
-- Check if there are orphaned memberships
-- ============================================

SELECT 
  '=== ORPHANED MEMBERSHIPS CHECK ===' as section,
  'Checking for memberships without valid organizations...' as description;

SELECT 
  om.id as membership_id,
  om.organization_id,
  om.user_id,
  om.role,
  CASE 
    WHEN o.id IS NULL THEN '❌ ORPHANED - Organization does not exist!'
    ELSE '✅ Valid'
  END as status
FROM organization_memberships om
LEFT JOIN organizations o ON om.organization_id = o.id
WHERE om.user_id = auth.uid();

-- ============================================
-- Raw table access test (without RLS)
-- ============================================

SELECT 
  '=== RAW ACCESS TEST (ADMIN) ===' as section,
  'This should show ALL your memberships regardless of RLS' as description;

-- This will only work if you're running as superuser/service role
-- If it errors, that's okay - means you're running as regular user
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE '=== ATTEMPTING SUPERUSER ACCESS ===';
  
  FOR rec IN 
    SELECT 
      om.id,
      om.organization_id,
      om.role,
      om.user_id
    FROM organization_memberships om
    WHERE om.user_id = auth.uid()
  LOOP
    RAISE NOTICE 'Membership: ID=%, Org=%, Role=%', rec.id, rec.organization_id, rec.role;
  END LOOP;
  
  IF NOT FOUND THEN
    RAISE NOTICE '❌ No memberships found for this user';
  END IF;
END $$;

