-- ============================================
-- FINAL FIX: Ultra-Simple Non-Recursive Policy
-- ============================================
-- This uses the ABSOLUTE SIMPLEST approach possible

-- Step 1: Drop EVERY policy (brute force)
DO $$ 
DECLARE 
  pol RECORD;
BEGIN
  -- Drop all policies on organization_memberships
  FOR pol IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'organization_memberships'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON organization_memberships CASCADE', pol.policyname);
    RAISE NOTICE 'Dropped: %', pol.policyname;
  END LOOP;
  
  -- Double-check they're gone
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'organization_memberships'
  ) THEN
    RAISE EXCEPTION 'Policies still exist after DROP!';
  END IF;
  
  RAISE NOTICE '✅ All policies dropped successfully';
END $$;

-- Step 2: Create ONLY ONE simple SELECT policy
-- This policy has ZERO dependencies - it cannot be recursive
CREATE POLICY "simple_select_own_membership"
  ON organization_memberships
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Step 3: Create INSERT policy (for new user signups)
CREATE POLICY "simple_insert_membership"
  ON organization_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Step 4: Allow service role to do everything (for triggers)
CREATE POLICY "service_role_all_access"
  ON organization_memberships
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- VERIFICATION
-- ============================================

-- Show what was created
SELECT 
  '=== POLICIES CREATED ===' as status,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'organization_memberships'
ORDER BY policyname;

-- Test access
SELECT 
  '=== YOUR MEMBERSHIP TEST ===' as status;

SELECT 
  om.id,
  om.role,
  om.organization_id,
  o.name as org_name
FROM organization_memberships om
JOIN organizations o ON om.organization_id = o.id
WHERE om.user_id = auth.uid()
LIMIT 1;

-- If this shows your membership with role='owner', SUCCESS!

-- ============================================
-- IMPORTANT NOTE
-- ============================================

SELECT '========================================' as note;
SELECT 'This creates MINIMAL policies for now:' as note;
SELECT '1. Users can see their OWN membership only' as note;
SELECT '2. Users can insert their own membership' as note;
SELECT '3. Service role has full access (for triggers)' as note;
SELECT '' as note;
SELECT 'This is SAFE and NON-RECURSIVE.' as note;
SELECT 'You can add more policies later once this works.' as note;
SELECT '========================================' as note;

