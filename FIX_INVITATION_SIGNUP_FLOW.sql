-- Fix: Handle new user signup to check for pending invitations
-- This ensures that invited users don't create duplicate organizations

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Updated function to check for pending invitations
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_org_id UUID;
  pending_invite RECORD;
  trial_start TIMESTAMPTZ := NOW();
  trial_end TIMESTAMPTZ := NOW() + INTERVAL '14 days';
BEGIN
  -- First, create the profile (always needed)
  -- But DON'T set organization_id yet - we'll set it based on whether they have an invite
  INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NOW(),
    NOW()
  );
  
  -- Check if this user has any pending invitations
  SELECT *
  INTO pending_invite
  FROM organization_invitations
  WHERE email = LOWER(NEW.email)
    AND status = 'pending'
    AND expires_at > NOW()
  ORDER BY created_at ASC  -- Get the oldest pending invite
  LIMIT 1;
  
  -- If there's a pending invitation, don't create a new organization
  -- The invitation acceptance flow will handle creating the membership
  -- But we DO need to set their profile's organization_id and create the membership immediately
  IF pending_invite.id IS NOT NULL THEN
    -- Update profile with the organization from the invitation
    UPDATE public.profiles
    SET organization_id = pending_invite.organization_id
    WHERE id = NEW.id;
    
    -- Create organization membership immediately
    INSERT INTO organization_memberships (
      organization_id,
      user_id,
      role,
      invited_by,
      invited_at,
      joined_at,
      created_at,
      updated_at
    )
    VALUES (
      pending_invite.organization_id,
      NEW.id,
      pending_invite.role,
      pending_invite.invited_by,
      pending_invite.created_at,
      NOW(),
      NOW(),
      NOW()
    );
    
    -- Mark the invitation as accepted
    UPDATE organization_invitations
    SET status = 'accepted'
    WHERE id = pending_invite.id;
    
  ELSE
    -- No pending invitation - create a new organization for this user
    -- This is the normal signup flow
    INSERT INTO organizations (owner_id, name, created_at, updated_at)
    VALUES (
      NEW.id,
      SPLIT_PART(NEW.email, '@', 1) || '''s Workspace',
      NOW(),
      NOW()
    )
    RETURNING id INTO new_org_id;
    
    -- Update profile with their new organization
    UPDATE public.profiles
    SET organization_id = new_org_id
    WHERE id = NEW.id;
    
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
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- ALSO: Update the invitation acceptance page to not duplicate membership creation
-- since the trigger now handles it automatically
-- This is documented here, but the actual code change needs to be done in 
-- app/auth/accept-invite/page.tsx (remove membership creation logic)
-- ============================================

COMMENT ON FUNCTION public.handle_new_user() IS 'Automatically creates profile and either joins invited organization or creates new organization for user';

