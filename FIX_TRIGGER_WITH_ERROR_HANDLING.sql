-- FINAL FIX: Trigger with proper error handling and validation
-- This will work and show errors if something fails

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_org_id UUID;
  trial_start TIMESTAMPTZ := NOW();
  trial_end TIMESTAMPTZ := NOW() + INTERVAL '14 days';
BEGIN
  -- Step 1: Create organization
  BEGIN
    INSERT INTO organizations (owner_id, name, created_at, updated_at)
    VALUES (
      NEW.id,
      SPLIT_PART(NEW.email, '@', 1) || '''s Workspace',
      NOW(),
      NOW()
    )
    RETURNING id INTO new_org_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to create organization for user %: %', NEW.email, SQLERRM;
    RETURN NEW; -- Allow signup to continue even if org creation fails
  END;
  
  -- Step 2: Create profile with organization_id
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, organization_id, created_at, updated_at)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
      new_org_id,
      NOW(),
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to create profile for user %: %', NEW.email, SQLERRM;
    RETURN NEW;
  END;
  
  -- Step 3: Create organization membership (user as owner)
  BEGIN
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
      NEW.id,
      'owner',
      NOW(),
      NOW(),
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to create membership for user %: %', NEW.email, SQLERRM;
    -- Continue anyway
  END;
  
  -- Step 4: Create free trial subscription (14 days)
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to create subscription for user %: %', NEW.email, SQLERRM;
    -- Continue anyway
  END;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Verify trigger was created
SELECT 'Trigger created with error handling!' as status;


