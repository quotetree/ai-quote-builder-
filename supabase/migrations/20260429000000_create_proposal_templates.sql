-- Migration: Create proposal_templates table
-- One template per organization for the proposal PDF builder.

CREATE TABLE IF NOT EXISTS proposal_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL DEFAULT 'Untitled Proposal',
  pages           jsonb       NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE proposal_templates ENABLE ROW LEVEL SECURITY;

-- All org members can read the template
CREATE POLICY "proposal_templates_select"
  ON proposal_templates FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- All org members can create the template (enforced to one via UNIQUE on organization_id)
CREATE POLICY "proposal_templates_insert"
  ON proposal_templates FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- All org members can update the template
CREATE POLICY "proposal_templates_update"
  ON proposal_templates FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );
