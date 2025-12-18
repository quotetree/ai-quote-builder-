-- Check for database issues that might be causing the 500 error

-- 1. Check if tables exist
SELECT 
    table_name,
    'EXISTS' as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('profiles', 'organizations', 'organization_memberships', 'subscriptions');

-- 2. Check profiles table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;

-- 3. Check for duplicate users that might cause conflicts
SELECT 
    email,
    COUNT(*) as count
FROM auth.users
GROUP BY email
HAVING COUNT(*) > 1;

-- 4. Check for orphaned profiles (profiles without users)
SELECT 
    p.id,
    p.email,
    u.id as user_id
FROM profiles p
LEFT JOIN auth.users u ON p.id = u.id
WHERE u.id IS NULL;

-- 5. Check organizations table for issues
SELECT 
    o.id,
    o.owner_id,
    u.email
FROM organizations o
LEFT JOIN auth.users u ON o.owner_id = u.id
WHERE u.id IS NULL
LIMIT 10;

-- 6. Check if there are any policies blocking inserts
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies
WHERE tablename IN ('profiles', 'organizations', 'organization_memberships', 'subscriptions')
AND cmd = 'INSERT';


