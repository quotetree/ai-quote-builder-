-- Free unique quote export entitlements (atomic reservation)
-- + profiles.onboarding_completed_at

-- ============================================
-- Onboarding
-- ============================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ NULL;

-- ============================================
-- Usage tables
-- ============================================
CREATE TABLE IF NOT EXISTS organization_usage_periods (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  unique_quotes_exported INT NOT NULL DEFAULT 0
    CHECK (unique_quotes_exported >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, period_key)
);

CREATE TABLE IF NOT EXISTS organization_quote_export_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  first_exported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_exported_by UUID REFERENCES auth.users(id),
  CONSTRAINT organization_quote_export_credits_unique
    UNIQUE (organization_id, quote_id, period_key)
);

CREATE INDEX IF NOT EXISTS organization_quote_export_credits_org_period_idx
  ON organization_quote_export_credits (organization_id, period_key);

ALTER TABLE organization_usage_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_quote_export_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view usage periods" ON organization_usage_periods;
CREATE POLICY "Org members can view usage periods"
  ON organization_usage_periods FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Org members can view export credits" ON organization_quote_export_credits;
CREATE POLICY "Org members can view export credits"
  ON organization_quote_export_credits FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Writes only via SECURITY DEFINER RPCs
GRANT SELECT ON organization_usage_periods TO authenticated;
GRANT SELECT ON organization_quote_export_credits TO authenticated;
GRANT ALL ON organization_usage_periods TO service_role;
GRANT ALL ON organization_quote_export_credits TO service_role;

-- ============================================
-- Period helpers (America/Los_Angeles calendar month)
-- ============================================
CREATE OR REPLACE FUNCTION public.free_quote_export_period_bounds(p_at TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (
  period_key TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    to_char((p_at AT TIME ZONE 'America/Los_Angeles'), 'YYYY-MM') AS period_key,
    (
      date_trunc('month', p_at AT TIME ZONE 'America/Los_Angeles')
      AT TIME ZONE 'America/Los_Angeles'
    ) AS period_start,
    (
      (date_trunc('month', p_at AT TIME ZONE 'America/Los_Angeles') + INTERVAL '1 month')
      AT TIME ZONE 'America/Los_Angeles'
    ) AS period_end;
$$;

-- ============================================
-- reserve_quote_export_credit(p_quote_id)
-- Authz: auth.uid() must be member of quote's org. No client org_id.
-- ============================================
CREATE OR REPLACE FUNCTION public.reserve_quote_export_credit(p_quote_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;
  v_plan_type TEXT;
  v_status TEXT;
  v_period RECORD;
  v_used INT;
  v_limit INT := 5;
  v_is_unlimited BOOLEAN := false;
  v_credit_exists BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'UNAUTHENTICATED',
      'message', 'Authentication required'
    );
  END IF;

  IF p_quote_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'INVALID_QUOTE',
      'message', 'Quote ID is required'
    );
  END IF;

  -- Resolve org from quote; never trust client-supplied organization_id
  SELECT q.organization_id
  INTO v_org_id
  FROM quotes q
  WHERE q.id = p_quote_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'QUOTE_NOT_FOUND',
      'message', 'Quote not found'
    );
  END IF;

  -- Membership check for that org
  IF NOT EXISTS (
    SELECT 1
    FROM organization_memberships m
    WHERE m.user_id = v_user_id
      AND m.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'code', 'NOT_AUTHORIZED',
      'message', 'Not a member of this organization'
    );
  END IF;

  SELECT s.plan_type, s.status
  INTO v_plan_type, v_status
  FROM subscriptions s
  WHERE s.organization_id = v_org_id
  ORDER BY s.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_plan_type IS NULL THEN
    v_plan_type := 'free';
    v_status := 'active';
  END IF;

  -- Paid active/trialing → unlimited
  IF v_plan_type IN ('individual', 'organization')
     AND v_status IN ('active', 'trialing') THEN
    v_is_unlimited := true;
  END IF;

  -- Free entitlements also apply when paid has ended (canceled/expired/past_due)
  -- or perpetual free/active

  SELECT * INTO v_period FROM public.free_quote_export_period_bounds(now());

  IF v_is_unlimited THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'consumed', false,
      'unlimited', true,
      'used', NULL,
      'limit', NULL,
      'period_key', v_period.period_key,
      'period_start', v_period.period_start,
      'period_end', v_period.period_end,
      'organization_id', v_org_id,
      'quote_id', p_quote_id
    );
  END IF;

  INSERT INTO organization_usage_periods (
    organization_id,
    period_key,
    period_start,
    period_end,
    unique_quotes_exported
  )
  VALUES (
    v_org_id,
    v_period.period_key,
    v_period.period_start,
    v_period.period_end,
    0
  )
  ON CONFLICT (organization_id, period_key) DO NOTHING;

  SELECT unique_quotes_exported
  INTO v_used
  FROM organization_usage_periods
  WHERE organization_id = v_org_id
    AND period_key = v_period.period_key
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1
    FROM organization_quote_export_credits c
    WHERE c.organization_id = v_org_id
      AND c.quote_id = p_quote_id
      AND c.period_key = v_period.period_key
  )
  INTO v_credit_exists;

  IF v_credit_exists THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'consumed', false,
      'unlimited', false,
      'used', v_used,
      'limit', v_limit,
      'period_key', v_period.period_key,
      'period_start', v_period.period_start,
      'period_end', v_period.period_end,
      'organization_id', v_org_id,
      'quote_id', p_quote_id
    );
  END IF;

  IF v_used >= v_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'consumed', false,
      'unlimited', false,
      'code', 'QUOTE_EXPORT_LIMIT_REACHED',
      'used', v_used,
      'limit', v_limit,
      'period_key', v_period.period_key,
      'period_start', v_period.period_start,
      'period_end', v_period.period_end,
      'organization_id', v_org_id,
      'quote_id', p_quote_id,
      'message', 'Free plan limit of 5 unique quote exports this month has been reached'
    );
  END IF;

  INSERT INTO organization_quote_export_credits (
    organization_id,
    quote_id,
    period_key,
    first_exported_by
  )
  VALUES (
    v_org_id,
    p_quote_id,
    v_period.period_key,
    v_user_id
  );

  UPDATE organization_usage_periods
  SET
    unique_quotes_exported = unique_quotes_exported + 1,
    updated_at = now()
  WHERE organization_id = v_org_id
    AND period_key = v_period.period_key
  RETURNING unique_quotes_exported INTO v_used;

  RETURN jsonb_build_object(
    'allowed', true,
    'consumed', true,
    'unlimited', false,
    'used', v_used,
    'limit', v_limit,
    'period_key', v_period.period_key,
    'period_start', v_period.period_start,
    'period_end', v_period.period_end,
    'organization_id', v_org_id,
    'quote_id', p_quote_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_quote_export_credit(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_quote_export_credit(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quote_export_credit(UUID) TO service_role;

-- ============================================
-- get_free_quote_export_usage() — read-only status for UI
-- ============================================
CREATE OR REPLACE FUNCTION public.get_free_quote_export_usage()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;
  v_plan_type TEXT;
  v_status TEXT;
  v_period RECORD;
  v_used INT := 0;
  v_limit INT := 5;
  v_unlimited BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'UNAUTHENTICATED');
  END IF;

  SELECT m.organization_id
  INTO v_org_id
  FROM organization_memberships m
  WHERE m.user_id = v_user_id
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'NO_ORGANIZATION');
  END IF;

  SELECT s.plan_type, s.status
  INTO v_plan_type, v_status
  FROM subscriptions s
  WHERE s.organization_id = v_org_id
  ORDER BY s.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_plan_type IS NULL THEN
    v_plan_type := 'free';
    v_status := 'active';
  END IF;

  IF v_plan_type IN ('individual', 'organization')
     AND v_status IN ('active', 'trialing') THEN
    v_unlimited := true;
  END IF;

  SELECT * INTO v_period FROM public.free_quote_export_period_bounds(now());

  SELECT COALESCE(p.unique_quotes_exported, 0)
  INTO v_used
  FROM organization_usage_periods p
  WHERE p.organization_id = v_org_id
    AND p.period_key = v_period.period_key;

  IF v_used IS NULL THEN
    v_used := 0;
  END IF;

  RETURN jsonb_build_object(
    'unlimited', v_unlimited,
    'used', v_used,
    'limit', CASE WHEN v_unlimited THEN NULL ELSE v_limit END,
    'period_key', v_period.period_key,
    'period_start', v_period.period_start,
    'period_end', v_period.period_end,
    'organization_id', v_org_id,
    'plan_type', v_plan_type,
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_free_quote_export_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_free_quote_export_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_free_quote_export_usage() TO service_role;
