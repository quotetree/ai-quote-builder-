-- Write grants on organization API keys. An empty list means the key can only read.

ALTER TABLE organization_api_keys
  ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}'
  CONSTRAINT organization_api_keys_permissions_known
    CHECK (permissions <@ ARRAY['quotes:create', 'quotes:update', 'quotes:delete']::TEXT[]);
-- Existing rows: permissions = '{}' (read-only).
