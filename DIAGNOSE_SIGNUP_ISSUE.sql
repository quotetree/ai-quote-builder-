-- Diagnostic script to check what's happening with signup

-- 1. Check if the new trigger exists and is active
SELECT 
    tgname as trigger_name,
    proname as function_name,
    tgenabled as is_enabled
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE tgname = 'on_auth_user_created';

-- 2. Check recent auth.users entries (last 10)
SELECT 
    id,
    email,
    created_at,
    confirmed_at,
    email_confirmed_at,
    raw_user_meta_data
FROM auth.users
ORDER BY created_at DESC
LIMIT 10;

-- 3. Check if profiles were created for recent users
SELECT 
    u.email,
    u.created_at as user_created,
    p.id as profile_id,
    p.organization_id,
    p.created_at as profile_created
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.id
ORDER BY u.created_at DESC
LIMIT 10;

-- 4. Check if organization_memberships were created
SELECT 
    u.email,
    om.organization_id,
    om.role,
    om.created_at
FROM auth.users u
LEFT JOIN organization_memberships om ON u.id = om.user_id
ORDER BY u.created_at DESC
LIMIT 10;

-- 5. Check for any trigger errors in logs
-- (This needs to be checked in Supabase Dashboard -> Logs)

-- 6. Test the trigger function manually (optional)
-- This will show you any errors
DO $$
DECLARE
    test_result TEXT;
BEGIN
    -- You can uncomment this to test, but be careful
    -- RAISE NOTICE 'Trigger function exists and is callable';
END $$;


