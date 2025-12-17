-- ============================================
-- CREATE ORGANIZATION FOR CURRENT USER
-- ============================================
-- This sets up your organization, membership, and subscription

-- First, let's check your current state
SELECT 'Current User Info' as check_name, 
  auth.uid() as user_id,
  email,
  full_name
FROM profiles 
WHERE id = auth.uid();

-- Check if you already have an organization
SELECT 'Existing Organizations' as check_name,
  COUNT(*) as org_count
FROM organizations o
JOIN organization_memberships om ON o.id = om.organization_id
WHERE om.user_id = auth.uid();

-- ============================================
-- CREATE YOUR ORGANIZATION (if needed)
-- ============================================

-- This will create an organization for you
DO $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_email TEXT;
  v_company_name TEXT;
  v_org_id UUID;
  v_org_exists BOOLEAN;
BEGIN
  -- Get user info
  SELECT email, 
         COALESCE(company_name, SPLIT_PART(email, '@', 1) || '''s Workspace')
  INTO v_user_email, v_company_name
  FROM profiles 
  WHERE id = v_user_id;

  -- Check if organization already exists
  SELECT EXISTS(
    SELECT 1 FROM organization_memberships 
    WHERE user_id = v_user_id
  ) INTO v_org_exists;

  IF v_org_exists THEN
    RAISE NOTICE 'User already has an organization';
  ELSE
    -- Create organization
    INSERT INTO organizations (owner_id, name, created_at, updated_at)
    VALUES (v_user_id, v_company_name, NOW(), NOW())
    RETURNING id INTO v_org_id;
    
    RAISE NOTICE 'Created organization: %', v_org_id;
    
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
      v_org_id,
      v_user_id,
      'owner',
      NOW(),
      NOW(),
      NOW()
    );
    
    RAISE NOTICE 'Created owner membership';
    
    -- Create free trial subscription
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
      v_org_id,
      'free',
      'trialing',
      NOW(),
      NOW() + INTERVAL '30 days',
      NOW(),
      NOW() + INTERVAL '30 days',
      1,
      0,
      0,
      0,
      NOW(),
      NOW()
    );
    
    RAISE NOTICE 'Created trial subscription';
  END IF;
END $$;

-- ============================================
-- VERIFY YOUR SETUP
-- ============================================

SELECT 'Your Organization' as info,
  o.id as org_id,
  o.name as org_name,
  o.owner_id,
  o.created_at
FROM organizations o
JOIN organization_memberships om ON o.id = om.organization_id
WHERE om.user_id = auth.uid();

SELECT 'Your Membership' as info,
  om.role,
  om.joined_at,
  o.name as org_name
FROM organization_memberships om
JOIN organizations o ON o.id = om.organization_id
WHERE om.user_id = auth.uid();

SELECT 'Your Subscription' as info,
  s.plan_type,
  s.status,
  s.total_licenses,
  s.trial_end_date,
  EXTRACT(DAY FROM (s.trial_end_date - NOW())) as days_left_in_trial
FROM subscriptions s
JOIN organization_memberships om ON s.organization_id = om.organization_id
WHERE om.user_id = auth.uid();

-- ============================================
-- FINAL VERIFICATION
-- ============================================

SELECT 
  '✅ SETUP COMPLETE' as status,
  'You now have an organization, membership, and trial subscription' as message;

