-- Organization-owned API keys. Only a SHA-256 hash of each key is stored.

CREATE TABLE IF NOT EXISTS organization_api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  key_prefix      TEXT NOT NULL,              -- display only, not secret
  key_hash        TEXT NOT NULL UNIQUE,       -- sha256 hex of the full plaintext
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ NOT NULL,       -- creation + 90 days, server-computed
  revoked_at      TIMESTAMPTZ,                -- NULL means live
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS organization_api_keys_org_idx
  ON organization_api_keys(organization_id);

ALTER TABLE organization_api_keys ENABLE ROW LEVEL SECURITY;

-- No policy is created. With RLS on and nothing matching, anon and authenticated
-- are denied on every verb; only service_role reaches this table.

-- Explicit grant, matching 20260914120100_quote_export_entitlements.sql, so
-- access does not rest on the project's default privileges.
GRANT ALL ON organization_api_keys TO service_role;

DROP TRIGGER IF EXISTS update_organization_api_keys_updated_at ON organization_api_keys;
CREATE TRIGGER update_organization_api_keys_updated_at
  BEFORE UPDATE ON organization_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
