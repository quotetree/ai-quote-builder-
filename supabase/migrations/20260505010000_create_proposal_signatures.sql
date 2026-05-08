-- Migration: Create proposal_signatures table for tracking Firma e-signature requests
-- One row per signing request sent for a proposal.

CREATE TABLE IF NOT EXISTS proposal_signatures (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id                   uuid        NOT NULL REFERENCES quote_proposals(id) ON DELETE CASCADE,
  organization_id               uuid        NOT NULL REFERENCES organizations(id)   ON DELETE CASCADE,

  -- Primary signer info (first signer by order)
  customer_name                 text,
  customer_email                text,

  -- Firma tracking IDs
  firma_signing_request_id      text,
  firma_signing_request_user_id text,       -- primary signer's Firma user ID
  signing_url                   text,       -- primary signer's signing URL

  -- All signers JSONB: [{ email, name, firma_user_id, signing_url }]
  all_signers_data              jsonb       NOT NULL DEFAULT '[]',

  -- Status: draft | sent | viewed | completed | declined | expired | failed
  status                        text        NOT NULL DEFAULT 'draft',

  -- Timestamps
  sent_at                       timestamptz,
  completed_at                  timestamptz,

  -- Completed document artifacts
  signed_pdf_url                text,
  audit_trail_url               text,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE proposal_signatures ENABLE ROW LEVEL SECURITY;

-- Org members can read signature records for their proposals
CREATE POLICY "proposal_signatures_select"
  ON proposal_signatures FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Org members can insert signature records
CREATE POLICY "proposal_signatures_insert"
  ON proposal_signatures FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Org members can update signature records
CREATE POLICY "proposal_signatures_update"
  ON proposal_signatures FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Index for fast lookup by proposal
CREATE INDEX IF NOT EXISTS proposal_signatures_proposal_id_idx
  ON proposal_signatures (proposal_id);

-- Index for webhook lookups by Firma signing request ID
CREATE INDEX IF NOT EXISTS proposal_signatures_firma_id_idx
  ON proposal_signatures (firma_signing_request_id)
  WHERE firma_signing_request_id IS NOT NULL;
