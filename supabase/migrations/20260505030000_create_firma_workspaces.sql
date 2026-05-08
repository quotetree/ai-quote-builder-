-- Migration: Create firma_workspaces table
-- Stores the per-organization Firma workspace ID and workspace-scoped API key.
-- Accessed ONLY via the service role key (no RLS policies = deny all anon/auth access).

CREATE TABLE IF NOT EXISTS firma_workspaces (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  firma_workspace_id    text        NOT NULL,
  firma_workspace_key   text        NOT NULL,   -- workspace-scoped API key from Firma
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Intentionally no RLS policies — this table contains API keys and must only
-- be accessed server-side via the Supabase service role key.
