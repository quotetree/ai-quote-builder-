-- Fix RLS policies on quote_items table
-- Make them org-centric so all org members can access quote line items

-- Drop old user-centric policies
DROP POLICY IF EXISTS "Users can view items in own quotes" ON quote_items;
DROP POLICY IF EXISTS "Users can insert items in own quotes" ON quote_items;
DROP POLICY IF EXISTS "Users can update items in own quotes" ON quote_items;
DROP POLICY IF EXISTS "Users can delete items in own quotes" ON quote_items;

-- Create new org-centric policies
-- All org members can view quote items in their org's quotes
CREATE POLICY "Org members can view quote items"
  ON quote_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM quotes q
      INNER JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE q.id = quote_items.quote_id
        AND om.user_id = auth.uid()
    )
  );

-- All org members can insert quote items in their org's quotes
CREATE POLICY "Org members can insert quote items"
  ON quote_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM quotes q
      INNER JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE q.id = quote_items.quote_id
        AND om.user_id = auth.uid()
    )
  );

-- All org members can update quote items in their org's quotes
CREATE POLICY "Org members can update quote items"
  ON quote_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM quotes q
      INNER JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE q.id = quote_items.quote_id
        AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM quotes q
      INNER JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE q.id = quote_items.quote_id
        AND om.user_id = auth.uid()
    )
  );

-- All org members can delete quote items in their org's quotes
CREATE POLICY "Org members can delete quote items"
  ON quote_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM quotes q
      INNER JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE q.id = quote_items.quote_id
        AND om.user_id = auth.uid()
    )
  );

-- Keep the shared quote items policy for external sharing
-- (already exists: "Org members can manage shared quote items")

