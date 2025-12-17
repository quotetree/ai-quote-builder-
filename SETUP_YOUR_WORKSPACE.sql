-- ============================================
-- SETUP WORKSPACE - Create Organization & Membership
-- ============================================
-- This will create everything you need to access workspace features

DO $$
DECLARE
  current_user_id UUID := auth.uid();
  user_email TEXT;
  new_org_id UUID;
  new_membership_id UUID;
  new_subscription_id UUID;
BEGIN
  -- Get user email
  SELECT email INTO user_email 
  FROM auth.users 
  WHERE id = current_user_id;
  
  RAISE NOTICE '🔧 Setting up workspace for: %', user_email;
  
  -- Create organization
  INSERT INTO organizations (
    owner_id, 
    name, 
    created_at, 
    updated_at
  )
  VALUES (
    current_user_id,
    SPLIT_PART(user_email, '@', 1) || '''s Workspace',
    NOW(),
    NOW()
  )
  RETURNING id INTO new_org_id;
  
  RAISE NOTICE '✅ Created organization: %', new_org_id;
  
  -- Create membership with owner role
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
  )
  RETURNING id INTO new_membership_id;
  
  RAISE NOTICE '✅ Created owner membership: %', new_membership_id;
  
  -- Create 14-day trial subscription
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
  )
  RETURNING id INTO new_subscription_id;
  
  RAISE NOTICE '✅ Created trial subscription: %', new_subscription_id;
  RAISE NOTICE '🎉 Workspace setup complete!';
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '❌ Error: %', SQLERRM;
    RAISE;
END $$;

-- ============================================
-- VERIFY SETUP
-- ============================================

SELECT '==================' as divider;
SELECT '✅ VERIFICATION' as status;
SELECT '==================' as divider;

-- Show your organization
SELECT 
  'Organization' as item,
  o.id,
  o.name,
  'Owner: ' || CASE WHEN o.owner_id = auth.uid() THEN 'YOU ✅' ELSE o.owner_id::TEXT END as owner
FROM organizations o
WHERE o.owner_id = auth.uid()
   OR o.id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid())
ORDER BY o.created_at DESC
LIMIT 1;

-- Show your membership
SELECT 
  'Membership' as item,
  om.id,
  om.role,
  om.organization_id
FROM organization_memberships om
WHERE om.user_id = auth.uid()
ORDER BY om.created_at DESC
LIMIT 1;

-- Show your subscription
SELECT 
  'Subscription' as item,
  s.plan_type,
  s.status,
  s.total_licenses as licenses,
  s.trial_end_date
FROM subscriptions s
WHERE s.organization_id IN (
  SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid()
)
ORDER BY s.created_at DESC
LIMIT 1;

-- Final check
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM organization_memberships 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
    THEN '🎉 SUCCESS - You are now an owner with full access!'
    ELSE '⚠️ WARNING - Something went wrong'
  END as final_status;

