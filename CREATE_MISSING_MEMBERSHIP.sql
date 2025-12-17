-- ============================================
-- EMERGENCY FIX: Create Missing Organization & Membership
-- ============================================
-- Run this if you don't have an organization_membership record

-- First, let's check what exists
DO $$
DECLARE
  current_user_id UUID := auth.uid();
  user_email TEXT;
  existing_org_id UUID;
  existing_membership_id UUID;
  new_org_id UUID;
BEGIN
  -- Get user email
  SELECT email INTO user_email FROM auth.users WHERE id = current_user_id;
  
  RAISE NOTICE 'Checking for user: % (%)', user_email, current_user_id;
  
  -- Check if organization exists
  SELECT id INTO existing_org_id FROM organizations WHERE owner_id = current_user_id LIMIT 1;
  
  IF existing_org_id IS NOT NULL THEN
    RAISE NOTICE '✅ Organization exists: %', existing_org_id;
    
    -- Check if membership exists
    SELECT id INTO existing_membership_id 
    FROM organization_memberships 
    WHERE user_id = current_user_id AND organization_id = existing_org_id;
    
    IF existing_membership_id IS NOT NULL THEN
      RAISE NOTICE '✅ Membership exists: %', existing_membership_id;
      RAISE NOTICE 'Everything looks good! No action needed.';
    ELSE
      RAISE NOTICE '❌ Membership MISSING - Creating...';
      
      -- Create missing membership
      INSERT INTO organization_memberships (
        organization_id,
        user_id,
        role,
        joined_at,
        created_at,
        updated_at
      )
      VALUES (
        existing_org_id,
        current_user_id,
        'owner',
        NOW(),
        NOW(),
        NOW()
      );
      
      RAISE NOTICE '✅ Created membership for organization: %', existing_org_id;
    END IF;
  ELSE
    RAISE NOTICE '❌ Organization MISSING - Creating...';
    
    -- Create organization
    INSERT INTO organizations (owner_id, name, created_at, updated_at)
    VALUES (
      current_user_id,
      SPLIT_PART(user_email, '@', 1) || '''s Workspace',
      NOW(),
      NOW()
    )
    RETURNING id INTO new_org_id;
    
    RAISE NOTICE '✅ Created organization: %', new_org_id;
    
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
    
    RAISE NOTICE '✅ Created membership';
    
    -- Check if subscription exists
    IF NOT EXISTS(SELECT 1 FROM subscriptions WHERE organization_id = new_org_id) THEN
      RAISE NOTICE '❌ Subscription MISSING - Creating...';
      
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
      
      RAISE NOTICE '✅ Created trial subscription';
    END IF;
  END IF;
END $$;

-- ============================================
-- VERIFY EVERYTHING IS NOW SET UP
-- ============================================

SELECT 
  'VERIFICATION' as section,
  '===================' as divider;

-- Show user info
SELECT 
  'User Info' as item,
  auth.uid() as user_id,
  u.email
FROM auth.users u
WHERE u.id = auth.uid();

-- Show organization
SELECT 
  'Organization' as item,
  o.id as organization_id,
  o.name,
  o.owner_id,
  CASE WHEN o.owner_id = auth.uid() THEN '✅ You are owner' ELSE '⚠️ Not owner' END as ownership
FROM organizations o
WHERE o.owner_id = auth.uid() OR o.id IN (
  SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid()
);

-- Show membership
SELECT 
  'Membership' as item,
  om.id as membership_id,
  om.organization_id,
  om.role,
  om.joined_at
FROM organization_memberships om
WHERE om.user_id = auth.uid();

-- Show subscription
SELECT 
  'Subscription' as item,
  s.id as subscription_id,
  s.plan_type,
  s.status,
  s.trial_end_date,
  s.total_licenses
FROM subscriptions s
WHERE s.organization_id IN (
  SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid()
);

-- Final status check
SELECT 
  '✅ SETUP COMPLETE' as status,
  'You should now have full access to workspace features' as message
WHERE EXISTS (
  SELECT 1 FROM organization_memberships 
  WHERE user_id = auth.uid() AND role = 'owner'
);

