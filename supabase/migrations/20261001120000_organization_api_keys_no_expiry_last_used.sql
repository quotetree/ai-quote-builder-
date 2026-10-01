-- API keys stay active until revoked, and record when they were last used on /api/v1.
-- Idempotent: safe on databases where these changes were already applied by hand.

ALTER TABLE organization_api_keys
  DROP COLUMN IF EXISTS expires_at;

ALTER TABLE organization_api_keys
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
