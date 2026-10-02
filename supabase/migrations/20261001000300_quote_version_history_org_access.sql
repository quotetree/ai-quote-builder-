-- Lets organization members read and write version history for their organization's quotes, not only quotes they own.

DROP POLICY IF EXISTS "Users can view their own quote version history" ON quote_version_history;
DROP POLICY IF EXISTS "System can insert version history" ON quote_version_history;
DROP POLICY IF EXISTS "Org members can view quote version history" ON quote_version_history;
DROP POLICY IF EXISTS "Org members can insert quote version history" ON quote_version_history;

CREATE POLICY "Org members can view quote version history"
  ON quote_version_history
  FOR SELECT
  USING (
    quote_id IN (
      SELECT id FROM quotes
      WHERE user_id = auth.uid()
        OR organization_id IN (
          SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Org members can insert quote version history"
  ON quote_version_history
  FOR INSERT
  WITH CHECK (
    quote_id IN (
      SELECT id FROM quotes
      WHERE user_id = auth.uid()
        OR organization_id IN (
          SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid()
        )
    )
  );
