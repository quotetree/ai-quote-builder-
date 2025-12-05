-- Add organization_id to profiles table for easier queries
-- This maintains backwards compatibility while making it easier to query user's organization

DO $$ 
BEGIN
  -- Add organization_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
    
    -- Populate organization_id for existing profiles
    UPDATE profiles p
    SET organization_id = (
      SELECT om.organization_id 
      FROM organization_memberships om 
      WHERE om.user_id = p.id 
      LIMIT 1
    )
    WHERE organization_id IS NULL;
    
    -- Add index for performance
    CREATE INDEX idx_profiles_organization_id ON profiles(organization_id);
  END IF;
END $$;

-- Update the handle_new_user trigger to also set organization_id in profiles
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

