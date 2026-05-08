-- Migration: Create quote_proposals table
-- One proposal per quote, seeded from the org template on first open.

CREATE TABLE IF NOT EXISTS quote_proposals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        uuid        NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pages           jsonb       NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quote_proposals ENABLE ROW LEVEL SECURITY;

-- Org members can read proposals for their quotes
CREATE POLICY "quote_proposals_select"
  ON quote_proposals FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Org members can create proposals
CREATE POLICY "quote_proposals_insert"
  ON quote_proposals FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Org members can update proposals
CREATE POLICY "quote_proposals_update"
  ON quote_proposals FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );
