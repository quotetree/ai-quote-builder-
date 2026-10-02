-- One row per quote write made with an organization API key, written in the same transaction as the write.

CREATE TABLE IF NOT EXISTS api_key_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nulled rather than removed if the key row is ever deleted, so the record of the write survives
  key_id          UUID REFERENCES organization_api_keys(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action          TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  -- No foreign key: the row must outlive a deleted quote. NULL for a create that made no quote.
  quote_id        UUID,
  outcome         TEXT NOT NULL CHECK (outcome IN ('ok', 'not_found', 'locked', 'too_large')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_key_audit_org_created_idx
  ON api_key_audit(organization_id, created_at DESC);

ALTER TABLE api_key_audit ENABLE ROW LEVEL SECURITY;

-- No policy is created, so only service_role reaches this table.
GRANT ALL ON api_key_audit TO service_role;

CREATE OR REPLACE FUNCTION public.api_key_audit_log(
  p_key_id UUID, p_organization_id UUID, p_action TEXT, p_quote_id UUID, p_outcome TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO api_key_audit (key_id, organization_id, action, quote_id, outcome)
  VALUES (p_key_id, p_organization_id, p_action, p_quote_id, p_outcome);
$$;

-- REVOKE FROM PUBLIC alone leaves Supabase's default grants to anon and authenticated in place
REVOKE ALL ON FUNCTION public.api_key_audit_log(UUID, UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_audit_log(UUID, UUID, TEXT, UUID, TEXT)
  TO service_role;
