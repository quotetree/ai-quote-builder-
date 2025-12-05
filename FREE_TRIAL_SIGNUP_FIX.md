# Free Trial Signup Fix - Database Update Guide

## Overview
This fix ensures that new users automatically get a 30-day free trial when they sign up.

## What Was Changed

### 1. Updated Trigger Function
- **File**: `supabase/profiles-trigger.sql`
- **What it does**: When a new user signs up, automatically creates:
  - Organization (named "{email}'s Workspace")
  - Organization membership (user as owner)
  - 30-day free trial subscription

### 2. New Migration File
- **File**: `supabase/migrations/20250105000000_add_organization_id_to_profiles.sql`
- **What it does**: 
  - Adds `organization_id` column to profiles table
  - Populates it for existing users
  - Updates the trigger function to set organization_id when creating profiles

## How to Apply These Changes

### Option 1: Run Both SQL Files (Recommended)

1. **Go to Supabase Dashboard** → SQL Editor

2. **Run the migration first**:
   - Copy entire contents of `supabase/migrations/20250105000000_add_organization_id_to_profiles.sql`
   - Paste into SQL Editor
   - Click "Run"
   
3. **Verify**: Check that profiles table now has `organization_id` column

### Option 2: Run Just the Trigger Update (If migration already applied)

1. **Go to Supabase Dashboard** → SQL Editor

2. **Run the trigger update**:
   - Copy entire contents of `supabase/profiles-trigger.sql`
   - Paste into SQL Editor
   - Click "Run"

## Testing

After applying the SQL changes:

1. **Create a test account**:
   - Go to your app's signup page
   - Create a new account with a test email
   - Complete email verification if required

2. **Verify trial is active**:
   - Log in with the test account
   - Go to Billing & Plans
   - Should see "Free Trial" with ~30 days remaining

3. **Check database** (optional):
   ```sql
   -- Replace with your test user's email
   SELECT 
     p.email,
     o.name as organization_name,
     s.plan_type,
     s.status,
     s.trial_end_date,
     s.total_licenses
   FROM profiles p
   JOIN organizations o ON p.organization_id = o.id
   JOIN subscriptions s ON o.id = s.organization_id
   WHERE p.email = 'test@example.com';
   ```

## Expected Results

For new signups:
- ✅ Profile created
- ✅ Organization created
- ✅ User is owner of organization
- ✅ Subscription status: "trialing"
- ✅ Trial period: 30 days from signup
- ✅ Plan type: "free"
- ✅ Licenses: 1

## Troubleshooting

### Error: "column organization_id does not exist"
- **Solution**: Run the migration file first (`20250105000000_add_organization_id_to_profiles.sql`)

### Error: "relation organizations does not exist"
- **Solution**: Make sure the main workspace migration (`20250123000000_add_workspace_settings.sql`) was applied first

### Existing test users don't have trials
- **Solution**: This fix only applies to NEW signups. For existing users without trials, run:
  ```sql
  -- Find users without organizations
  SELECT id, email FROM auth.users
  WHERE id NOT IN (SELECT user_id FROM organization_memberships);
  ```
  Then manually run the organization creation logic from the migration file.

## Rollback (if needed)

If you need to rollback:

```sql
-- Restore original trigger (creates profile only)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NOW(),
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Notes

- This is a **database-side change** - no code deployment needed for it to take effect
- Once applied, it works immediately for all new signups
- Existing users are not affected (their subscriptions remain unchanged)
- The trigger runs automatically on every new user signup

