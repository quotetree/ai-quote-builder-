-- Migration: Add UNIQUE constraint on proposal_signatures.proposal_id
--
-- The route uses upsert with onConflict: "proposal_id" to handle re-generates,
-- but the original table definition only has an index, not a unique constraint.
-- Without this constraint Postgres throws:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- We keep one active signature row per proposal (the latest send).

ALTER TABLE proposal_signatures
  ADD CONSTRAINT proposal_signatures_proposal_id_key UNIQUE (proposal_id);
