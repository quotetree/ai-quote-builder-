-- Migration: Add recipients JSONB column to quote_proposals
-- Each recipient: { id, first_name, last_name, email, phone?, role: 'signer'|'cc' }

ALTER TABLE quote_proposals
  ADD COLUMN IF NOT EXISTS recipients JSONB NOT NULL DEFAULT '[]';
