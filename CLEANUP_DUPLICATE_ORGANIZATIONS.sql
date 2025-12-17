-- Cleanup script for users who accepted invitations but have duplicate organizations
-- This script identifies and fixes users who have both their own organization AND
-- a membership in an invited organization

-- ============================================
-- STEP 1: Identify affected users
-- ============================================

SELECT 
  p.id,
  p.email,
  p.organization_id as profile_org_id,
  om.organization_id as membership_org_id,
  om.role,
  o1.name as profile_org_name,
  o2.name as membership_org_name,
  om.created_at as joined_at
FROM profiles p
JOIN organization_memberships om ON om.user_id = p.id
JOIN organizations o1 ON o1.id = p.organization_id
JOIN organizations o2 ON o2.id = om.organization_id
WHERE p.organization_id != om.organization_id
  AND om.role IN ('admin', 'super_admin')  -- They were invited, not owners
ORDER BY om.created_at DESC;

-- ============================================
-- STEP 2: Fix affected users
-- This updates their profile to use the correct organization
-- and migrates any projects they created to the correct organization
-- ============================================

DO $$
DECLARE
  user_record RECORD;
  correct_org_id UUID;
  old_org_id UUID;
BEGIN
  -- Find all users with mismatched organizations
  FOR user_record IN 
    SELECT DISTINCT
      p.id as user_id,
      p.organization_id as old_org_id,
      om.organization_id as correct_org_id,
      om.role
    FROM profiles p
    JOIN organization_memberships om ON om.user_id = p.id
    WHERE p.organization_id != om.organization_id
      AND om.role IN ('admin', 'super_admin')
  LOOP
    RAISE NOTICE 'Fixing user % - moving from org % to org %', 
      user_record.user_id, user_record.old_org_id, user_record.correct_org_id;
    
    -- Update profile to use correct organization
    UPDATE profiles
    SET organization_id = user_record.correct_org_id
    WHERE id = user_record.user_id;
    
    -- Migrate any projects to the correct organization
    UPDATE projects
    SET organization_id = user_record.correct_org_id
    WHERE user_id = user_record.user_id
      AND organization_id = user_record.old_org_id;
    
    -- Migrate any products to the correct organization
    UPDATE products
    SET organization_id = user_record.correct_org_id
    WHERE user_id = user_record.user_id
      AND organization_id = user_record.old_org_id;
    
    -- Migrate any product_families to the correct organization
    UPDATE product_families
    SET organization_id = user_record.correct_org_id
    WHERE user_id = user_record.user_id
      AND organization_id = user_record.old_org_id;
    
    -- Migrate any quotes to the correct organization
    UPDATE quotes
    SET organization_id = user_record.correct_org_id
    WHERE user_id = user_record.user_id
      AND organization_id = user_record.old_org_id;
    
    -- Remove the duplicate membership from the old organization (if it exists)
    DELETE FROM organization_memberships
    WHERE user_id = user_record.user_id
      AND organization_id = user_record.old_org_id;
    
    -- Delete the old organization if it has no members and no data
    DELETE FROM organizations
    WHERE id = user_record.old_org_id
      AND NOT EXISTS (
        SELECT 1 FROM organization_memberships
        WHERE organization_id = user_record.old_org_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM projects
        WHERE organization_id = user_record.old_org_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM products
        WHERE organization_id = user_record.old_org_id
      );
    
    RAISE NOTICE 'Fixed user %', user_record.user_id;
  END LOOP;
  
  RAISE NOTICE 'Cleanup complete';
END $$;

-- ============================================
-- STEP 3: Verify the fix
-- ============================================

-- This should return no rows after the fix
SELECT 
  p.id,
  p.email,
  p.organization_id as profile_org_id,
  om.organization_id as membership_org_id
FROM profiles p
JOIN organization_memberships om ON om.user_id = p.id
WHERE p.organization_id != om.organization_id;

-- Show all current memberships
SELECT 
  o.name as organization,
  p.email,
  om.role,
  om.joined_at
FROM organization_memberships om
JOIN profiles p ON p.id = om.user_id
JOIN organizations o ON o.id = om.organization_id
ORDER BY o.name, om.role, om.joined_at;

