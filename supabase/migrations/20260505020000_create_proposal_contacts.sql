-- Migration: Create proposal_contacts table for autocomplete
-- Saved contacts per organization — populated whenever a recipient is added to a proposal.

CREATE TABLE IF NOT EXISTS proposal_contacts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name      text        NOT NULL,
  last_name       text        NOT NULL DEFAULT '',
  email           text        NOT NULL,
  phone           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, email)
);

ALTER TABLE proposal_contacts ENABLE ROW LEVEL SECURITY;

-- Org members can read contacts for their org
CREATE POLICY "proposal_contacts_select"
  ON proposal_contacts FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Org members can create contacts
CREATE POLICY "proposal_contacts_insert"
  ON proposal_contacts FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Org members can update contacts
CREATE POLICY "proposal_contacts_update"
  ON proposal_contacts FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Org members can delete contacts
CREATE POLICY "proposal_contacts_delete"
  ON proposal_contacts FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );
