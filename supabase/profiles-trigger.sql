-- Function to automatically create profile, organization, and trial subscription when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_org_id UUID;
  trial_start TIMESTAMPTZ := NOW();
  trial_end TIMESTAMPTZ := NOW() + INTERVAL '14 days';
BEGIN
  -- Create organization for the new user first
  INSERT INTO organizations (owner_id, name, created_at, updated_at)
  VALUES (
    NEW.id,
    SPLIT_PART(NEW.email, '@', 1) || '''s Workspace',
    NOW(),
    NOW()
  )
  RETURNING id INTO new_org_id;
  
  -- Create profile with organization_id
  INSERT INTO public.profiles (id, email, full_name, organization_id, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    new_org_id,
    NOW(),
    NOW()
  );
  
  -- Create organization membership (user as owner)
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
  
  -- Create free trial subscription (14 days)
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
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function when a new user is created
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

