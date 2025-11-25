# Troubleshooting Workspace Settings

## Issues Found & Fixed

### 1. ✅ Next.js Image Configuration Error
**Error**: `hostname "botdqsijtgknchkshnyp.supabase.co" is not configured under images in your next.config.js`

**Fix Applied**: Updated `next.config.ts` to allow Supabase storage URLs:
```typescript
images: {
  remotePatterns: [
    {
      protocol: 'https',
      hostname: '*.supabase.co',
      port: '',
      pathname: '/storage/v1/object/public/**',
    },
  ],
}
```

### 2. ✅ Profiles Foreign Key Reference Error
**Error**: Invalid foreign key reference in query

**Fix Applied**: Simplified the profiles join in `MembersModal.tsx` from:
```typescript
profile:profiles!organization_memberships_user_id_fkey (...)
```
to:
```typescript
profile:profiles(...)
```

### 3. ⚠️ RPC Function Error (400)
**Error**: `Failed to load resource: the server responded with a status of 400`

**Possible Causes**:
- Migration didn't run completely
- RPC function doesn't exist
- User doesn't have an organization yet

## Verification Steps

Run these queries in **Supabase SQL Editor** to verify the migration:

### Step 1: Check if tables exist
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('organizations', 'organization_memberships', 'subscriptions', 'organization_invitations')
ORDER BY table_name;
```
**Expected**: Should return all 4 table names

### Step 2: Check if RPC function exists
```sql
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name = 'get_user_organization_membership';
```
**Expected**: Should return the function name

### Step 3: Check if you have an organization
```sql
-- Replace 'your-user-id' with your actual user ID
-- To get your user ID, run: SELECT auth.uid();

SELECT * FROM organizations 
WHERE owner_id = auth.uid();
```
**Expected**: Should return your organization

### Step 4: Check if you have a membership
```sql
SELECT * FROM organization_memberships 
WHERE user_id = auth.uid();
```
**Expected**: Should return your membership with role 'owner'

### Step 5: Check if you have a subscription
```sql
SELECT 
  s.*,
  o.name as org_name
FROM subscriptions s
JOIN organizations o ON s.organization_id = o.id
WHERE o.owner_id = auth.uid();
```
**Expected**: Should return your free trial subscription

### Step 6: Test the RPC function
```sql
SELECT * FROM get_user_organization_membership(auth.uid());
```
**Expected**: Should return your organization context with all fields

## If Tables Don't Exist

The migration didn't run. Re-run the migration SQL:

1. Go to **Supabase SQL Editor**
2. Create **New Query**
3. Copy the entire SQL from: `supabase/migrations/20250123000000_add_workspace_settings.sql`
4. Click **Run**

## If RPC Function Doesn't Exist

Run just the function creation part:

```sql
CREATE OR REPLACE FUNCTION get_user_organization_membership(p_user_id UUID)
RETURNS TABLE (
  organization_id UUID,
  organization_name TEXT,
  role TEXT,
  plan_type TEXT,
  subscription_status TEXT,
  total_licenses INT,
  used_licenses BIGINT,
  available_licenses INT,
  trial_end_date TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id AS organization_id,
    o.name AS organization_name,
    om.role,
    s.plan_type,
    s.status AS subscription_status,
    s.total_licenses,
    (SELECT COUNT(*) FROM organization_memberships WHERE organization_id = o.id) AS used_licenses,
    (s.total_licenses - (SELECT COUNT(*) FROM organization_memberships WHERE organization_id = o.id))::INT AS available_licenses,
    s.trial_end_date
  FROM organization_memberships om
  JOIN organizations o ON om.organization_id = o.id
  JOIN subscriptions s ON o.id = s.organization_id
  WHERE om.user_id = p_user_id
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## If You Don't Have an Organization

Manually create one:

```sql
-- This creates an organization, membership, and subscription for the current user
DO $$
DECLARE
  current_user_id UUID;
  current_user_email TEXT;
  new_org_id UUID;
  trial_start TIMESTAMPTZ := NOW();
  trial_end TIMESTAMPTZ := NOW() + INTERVAL '30 days';
BEGIN
  -- Get current user
  SELECT auth.uid() INTO current_user_id;
  SELECT email FROM auth.users WHERE id = current_user_id INTO current_user_email;
  
  -- Create organization
  INSERT INTO organizations (owner_id, name, created_at, updated_at)
  VALUES (
    current_user_id,
    COALESCE(
      (SELECT company_name FROM profiles WHERE id = current_user_id),
      SPLIT_PART(current_user_email, '@', 1) || '''s Workspace'
    ),
    NOW(),
    NOW()
  )
  RETURNING id INTO new_org_id;
  
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
  
  -- Create subscription
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
    trial_start,
    trial_end,
    trial_start,
    trial_end,
    1,
    0,
    0,
    0,
    NOW(),
    NOW()
  );
  
  RAISE NOTICE 'Organization created successfully!';
END $$;
```

## After Fixes

1. **Restart your dev server**:
   ```bash
   # Stop the server (Ctrl+C)
   npm run dev
   ```

2. **Clear browser cache** or open in incognito/private mode

3. **Test again**:
   - Click your profile picture
   - Click "Members" or "Billing"
   - Should load without errors

## Common Issues

### "Failed to load members: Object"
- Check console for detailed error
- Verify RPC function exists (Step 2 above)
- Verify you have an organization (Step 3 above)

### "No organization found"
- Run the manual organization creation SQL above
- Or re-run the full migration

### Images not loading
- Make sure Next.js config has been updated
- Restart dev server after config change

### Still getting 400 errors
- Check Supabase logs in Dashboard → Logs
- Look for SQL errors or permission issues
- Verify RLS policies are enabled

## Need More Help?

1. Check browser console for detailed errors
2. Check Supabase logs in your dashboard
3. Run verification queries above
4. Share the console error messages

## Quick Diagnostic Query

Run this to see your complete setup:

```sql
SELECT 
  'User ID' as item, auth.uid()::text as value
UNION ALL
SELECT 
  'Has Organization', 
  CASE WHEN EXISTS(SELECT 1 FROM organizations WHERE owner_id = auth.uid()) 
    THEN 'YES' ELSE 'NO' END
UNION ALL
SELECT 
  'Has Membership', 
  CASE WHEN EXISTS(SELECT 1 FROM organization_memberships WHERE user_id = auth.uid()) 
    THEN 'YES' ELSE 'NO' END
UNION ALL
SELECT 
  'Has Subscription', 
  CASE WHEN EXISTS(
    SELECT 1 FROM subscriptions s 
    JOIN organizations o ON s.organization_id = o.id 
    WHERE o.owner_id = auth.uid()
  ) THEN 'YES' ELSE 'NO' END
UNION ALL
SELECT 
  'RPC Function Exists',
  CASE WHEN EXISTS(
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'get_user_organization_membership'
  ) THEN 'YES' ELSE 'NO' END;
```

All should show "YES"!

