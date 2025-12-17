-- ============================================
-- SIMPLE CHECK: Do you have orphaned memberships?
-- ============================================
-- Orphaned = membership exists but organization doesn't

-- Check your memberships and whether their organizations exist
SELECT 
  om.id as membership_id,
  om.organization_id,
  om.role,
  om.joined_at,
  CASE 
    WHEN o.id IS NOT NULL THEN '✅ Organization EXISTS'
    ELSE '❌ Organization MISSING (ORPHANED)'
  END as org_status,
  o.name as org_name,
  o.owner_id as org_owner
FROM organization_memberships om
LEFT JOIN organizations o ON om.organization_id = o.id
WHERE om.user_id = auth.uid();

-- Count summary
SELECT 
  COUNT(*) as total_memberships,
  COUNT(o.id) as valid_orgs,
  COUNT(*) - COUNT(o.id) as orphaned_memberships
FROM organization_memberships om
LEFT JOIN organizations o ON om.organization_id = o.id
WHERE om.user_id = auth.uid();

-- ============================================
-- If you have orphaned memberships, this will clean them up:
-- ============================================

-- UNCOMMENT THE SECTION BELOW ONLY IF YOU SEE ORPHANED MEMBERSHIPS ABOVE

/*
DO $$
DECLARE
  deleted_count INT;
  current_user_id UUID := auth.uid();
BEGIN
  -- Delete orphaned memberships
  WITH deleted AS (
    DELETE FROM organization_memberships om
    WHERE om.user_id = current_user_id
      AND NOT EXISTS (
        SELECT 1 FROM organizations o WHERE o.id = om.organization_id
      )
    RETURNING om.id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  
  RAISE NOTICE 'Deleted % orphaned membership(s)', deleted_count;
  
  -- Now create a proper organization and membership for you
  DECLARE
    new_org_id UUID;
    user_email TEXT;
  BEGIN
    -- Get email
    SELECT email INTO user_email FROM auth.users WHERE id = current_user_id;
    
    -- Create organization
    INSERT INTO organizations (owner_id, name, created_at, updated_at)
    VALUES (
      current_user_id,
      SPLIT_PART(user_email, '@', 1) || '''s Workspace',
      NOW(),
      NOW()
    )
    RETURNING id INTO new_org_id;
    
    RAISE NOTICE 'Created new organization: %', new_org_id;
    
    -- Create membership
    INSERT INTO organization_memberships (
      organization_id,
      user_id,
      role,
      joined_at,
      created_at,
      updated_at
    )
    VALUES (
      new_org_id,
      current_user_id,
      'owner',
      NOW(),
      NOW(),
      NOW()
    );
    
    RAISE NOTICE 'Created owner membership';
    
    -- Create trial subscription
    INSERT INTO subscriptions (
      organization_id,
      plan_type,
      status,
      trial_start_date,
      trial_end_date,
      current_period_start,
      current_period_end,
      base_licenses,
      additional_licenses,
      base_price_cents,
      additional_license_price_cents,
      created_at,
      updated_at
    )
    VALUES (
      new_org_id,
      'free',
      'trialing',
      NOW(),
      NOW() + INTERVAL '14 days',
      NOW(),
      NOW() + INTERVAL '14 days',
      1,
      0,
      0,
      0,
      NOW(),
      NOW()
    );
    
    RAISE NOTICE 'Created trial subscription';
    RAISE NOTICE '✅ Setup complete!';
  END;
END $$;
*/

-- ============================================
-- After running cleanup, verify everything is good:
-- ============================================

-- Show your current setup
SELECT 
  'Your Current Setup' as section,
  '==================' as divider;

SELECT 
  o.name as organization_name,
  om.role as your_role,
  s.plan_type,
  s.status as subscription_status,
  s.trial_end_date,
  CASE WHEN o.owner_id = auth.uid() THEN '✅ You are owner' ELSE '⚠️ Not owner' END as ownership_status
FROM organization_memberships om
JOIN organizations o ON om.organization_id = o.id
LEFT JOIN subscriptions s ON s.organization_id = o.id
WHERE om.user_id = auth.uid()
ORDER BY om.created_at DESC;

