-- Perpetual Free plan on signup (no 14-day trial)
-- Invite-aware: pending invitees join existing org without creating a subscription

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_org_id UUID;
  pending_invite RECORD;
BEGIN
  -- Pending invitation takes precedence (no new org / subscription)
  SELECT *
  INTO pending_invite
  FROM organization_invitations
  WHERE email = LOWER(NEW.email)
    AND status = 'pending'
    AND expires_at > NOW()
  ORDER BY created_at ASC
  LIMIT 1;

  IF pending_invite.id IS NOT NULL THEN
    target_org_id := pending_invite.organization_id;

    INSERT INTO public.profiles (id, email, full_name, organization_id, created_at, updated_at)
    VALUES (
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data->>'full_name',
      target_org_id,
      NOW(),
      NOW()
    );

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
      target_org_id,
      NEW.id,
      pending_invite.role,
      pending_invite.invited_by,
      pending_invite.created_at,
      NOW(),
      NOW(),
      NOW()
    );

    UPDATE organization_invitations
    SET status = 'accepted'
    WHERE id = pending_invite.id;
  ELSE
    INSERT INTO organizations (owner_id, name, created_at, updated_at)
    VALUES (
      NEW.id,
      SPLIT_PART(NEW.email, '@', 1) || '''s Workspace',
      NOW(),
      NOW()
    )
    RETURNING id INTO target_org_id;

    INSERT INTO public.profiles (id, email, full_name, organization_id, created_at, updated_at)
    VALUES (
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data->>'full_name',
      target_org_id,
      NOW(),
      NOW()
    );

    INSERT INTO organization_memberships (
      organization_id,
      user_id,
      role,
      joined_at,
      created_at,
      updated_at
    )
    VALUES (
      target_org_id,
      NEW.id,
      'owner',
      NOW(),
      NOW(),
      NOW()
    );

    -- Perpetual Free (not a trial)
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
      target_org_id,
      'free',
      'active',
      NULL,
      NULL,
      NOW(),
      NULL,
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
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates profile; joins invited org or creates workspace with perpetual Free subscription';

-- Migrate existing Free trials → perpetual Free
UPDATE subscriptions
SET
  status = 'active',
  trial_end_date = NULL,
  updated_at = NOW()
WHERE plan_type = 'free'
  AND status IN ('trialing', 'active');
