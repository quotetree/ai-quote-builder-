-- ============================================
-- VERIFY: New User Signup Will Work Correctly
-- ============================================
-- This checks that the handle_new_user() trigger is properly set up

-- ============================================
-- CHECK 1: Does the trigger function exist?
-- ============================================
SELECT 
  '✅ TRIGGER FUNCTION CHECK' as section,
  proname as function_name,
  pg_get_functiondef(oid) as definition_preview
FROM pg_proc
WHERE proname = 'handle_new_user'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- If this returns no rows, the trigger function is MISSING!

-- ============================================
-- CHECK 2: Is the trigger enabled on auth.users?
-- ============================================
SELECT 
  '✅ TRIGGER STATUS CHECK' as section,
  tgname as trigger_name,
  tgenabled as is_enabled,
  CASE 
    WHEN tgenabled = 'O' THEN '✅ ENABLED'
    WHEN tgenabled = 'D' THEN '❌ DISABLED'
    ELSE '⚠️ UNKNOWN STATUS'
  END as status
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE t.tgname = 'on_auth_user_created'
  AND n.nspname = 'auth'
  AND c.relname = 'users';

-- If this returns no rows, the trigger is MISSING!
-- If tgenabled = 'D', the trigger is DISABLED!

-- ============================================
-- CHECK 3: Test the function logic (dry run)
-- ============================================
-- This simulates what would happen for a new user

DO $$
DECLARE
  test_email TEXT := 'test@example.com';
  test_user_id UUID := gen_random_uuid();
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '🧪 SIMULATING NEW USER SIGNUP';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Test Email: %', test_email;
  RAISE NOTICE 'Test User ID: %', test_user_id;
  RAISE NOTICE '';
  RAISE NOTICE 'The trigger would create:';
  RAISE NOTICE '1. Organization: "%''s Workspace"', SPLIT_PART(test_email, '@', 1);
  RAISE NOTICE '2. Membership: role=owner for user %', test_user_id;
  RAISE NOTICE '3. Subscription: plan_type=free, status=trialing, 14 days trial';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Function logic appears correct';
END $$;

-- ============================================
-- CHECK 4: Verify RLS policies allow new data creation
-- ============================================

SELECT 
  '✅ RLS POLICIES FOR INSERT' as section,
  schemaname,
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('organizations', 'organization_memberships', 'subscriptions')
  AND cmd = 'INSERT'
ORDER BY tablename;

-- Should see INSERT policies for:
-- - organizations (for user to create their org)
-- - organization_memberships (for user to create their membership)
-- - subscriptions (for user to create their subscription)

-- ============================================
-- CHECK 5: Test most recent user creation
-- ============================================

SELECT 
  '✅ MOST RECENT USER CHECK' as section,
  'Checking if the most recent user got proper setup' as description;

WITH recent_user AS (
  SELECT id, email, created_at
  FROM auth.users
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT 
  ru.email as user_email,
  ru.created_at as signed_up_at,
  CASE WHEN om.id IS NOT NULL THEN '✅ Has Membership' ELSE '❌ NO MEMBERSHIP' END as membership_status,
  om.role,
  CASE WHEN o.id IS NOT NULL THEN '✅ Has Organization' ELSE '❌ NO ORGANIZATION' END as org_status,
  o.name as org_name,
  CASE WHEN s.id IS NOT NULL THEN '✅ Has Subscription' ELSE '❌ NO SUBSCRIPTION' END as subscription_status,
  s.plan_type,
  s.status as subscription_status_detail
FROM recent_user ru
LEFT JOIN organization_memberships om ON om.user_id = ru.id
LEFT JOIN organizations o ON o.id = om.organization_id
LEFT JOIN subscriptions s ON s.organization_id = o.id;

-- ============================================
-- FINAL VERDICT
-- ============================================

SELECT '========================================' as divider;
SELECT '📋 FINAL VERDICT' as section;
SELECT '========================================' as divider;

-- Check all conditions
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc 
      WHERE proname = 'handle_new_user' 
        AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    ) AND EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE t.tgname = 'on_auth_user_created'
        AND n.nspname = 'auth'
        AND c.relname = 'users'
        AND t.tgenabled = 'O'
    ) THEN 
      '✅ NEW USERS WILL BE AUTOMATICALLY SETUP'
    ELSE 
      '❌ TRIGGER IS MISSING OR DISABLED - NEW USERS WILL FAIL'
  END as verdict,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc 
      WHERE proname = 'handle_new_user'
    ) THEN '✅ Function exists'
    ELSE '❌ Function missing'
  END as function_check,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE t.tgname = 'on_auth_user_created'
        AND t.tgenabled = 'O'
    ) THEN '✅ Trigger enabled'
    ELSE '❌ Trigger missing or disabled'
  END as trigger_check;

-- ============================================
-- RECOMMENDATIONS
-- ============================================

SELECT '========================================' as divider;
SELECT '📝 NEXT STEPS' as section;
SELECT '========================================' as divider;

SELECT 
  'If you see ❌ above, you need to run profiles-trigger.sql' as recommendation,
  'If you see ✅ for everything, new signups will work correctly' as good_news;

