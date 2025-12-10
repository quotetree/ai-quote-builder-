-- Migration: Fix quote_items RLS to be organization-centric
-- This migration updates quote_items policies to match the org-centric model
-- used by the quotes table, enabling org members to view/edit quote items

-- ============================================
-- QUOTE_ITEMS TABLE - ORG-CENTRIC POLICIES
-- ============================================

-- Drop old user-centric policies
DROP POLICY IF EXISTS "Users can view items in own quotes" ON quote_items;
DROP POLICY IF EXISTS "Users can insert items in own quotes" ON quote_items;
DROP POLICY IF EXISTS "Users can update items in own quotes" ON quote_items;
DROP POLICY IF EXISTS "Users can delete items in own quotes" ON quote_items;

-- Create new org-centric policies
-- SELECT: All org members can view quote items in org quotes
CREATE POLICY "Org members can view org quote items"
  ON quote_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM quotes q
      WHERE q.id = quote_items.quote_id
        AND q.organization_id IN (
          SELECT organization_id FROM organization_memberships
          WHERE user_id = auth.uid()
        )
    )
  );

-- INSERT: All org members can create quote items in org quotes
CREATE POLICY "Org members can create quote items"
  ON quote_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM quotes q
      WHERE q.id = quote_items.quote_id
        AND q.organization_id IN (
          SELECT organization_id FROM organization_memberships
          WHERE user_id = auth.uid()
        )
    )
  );

-- UPDATE: All org members can update quote items in org quotes
CREATE POLICY "Org members can update org quote items"
  ON quote_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM quotes q
      WHERE q.id = quote_items.quote_id
        AND q.organization_id IN (
          SELECT organization_id FROM organization_memberships
          WHERE user_id = auth.uid()
        )
    )
  );

-- DELETE: All org members can delete quote items in org quotes
CREATE POLICY "Org members can delete org quote items"
  ON quote_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM quotes q
      WHERE q.id = quote_items.quote_id
        AND q.organization_id IN (
          SELECT organization_id FROM organization_memberships
          WHERE user_id = auth.uid()
        )
    )
  );

-- Keep existing shared project quote items policy (for external sharing)
-- This policy already exists and doesn't conflict

