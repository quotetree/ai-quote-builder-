-- Migration: Create quote_profit_overrides table
-- This table stores profit margin simulation overrides for quote analysis
-- These values are used ONLY for profit breakdown calculations and do NOT affect actual quotes

CREATE TABLE quote_profit_overrides (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE NOT NULL,
  item_id UUID REFERENCES quote_items(id) ON DELETE CASCADE NOT NULL,
  override_list_price DECIMAL(12, 2),
  override_sales_price DECIMAL(12, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(quote_id, item_id)
);

-- Create index for faster lookups by quote_id
CREATE INDEX idx_profit_overrides_quote_id ON quote_profit_overrides(quote_id);

-- Enable RLS
ALTER TABLE quote_profit_overrides ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Org members can manage profit overrides for their org's quotes
-- SELECT: All org members can view profit overrides in their org's quotes
CREATE POLICY "Org members can view profit overrides"
  ON quote_profit_overrides FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM quotes q
      INNER JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE q.id = quote_profit_overrides.quote_id
        AND om.user_id = auth.uid()
    )
  );

-- INSERT: All org members can create profit overrides in their org's quotes
CREATE POLICY "Org members can insert profit overrides"
  ON quote_profit_overrides FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM quotes q
      INNER JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE q.id = quote_profit_overrides.quote_id
        AND om.user_id = auth.uid()
    )
  );

-- UPDATE: All org members can update profit overrides in their org's quotes
CREATE POLICY "Org members can update profit overrides"
  ON quote_profit_overrides FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM quotes q
      INNER JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE q.id = quote_profit_overrides.quote_id
        AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM quotes q
      INNER JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE q.id = quote_profit_overrides.quote_id
        AND om.user_id = auth.uid()
    )
  );

-- DELETE: All org members can delete profit overrides in their org's quotes
CREATE POLICY "Org members can delete profit overrides"
  ON quote_profit_overrides FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM quotes q
      INNER JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE q.id = quote_profit_overrides.quote_id
        AND om.user_id = auth.uid()
    )
  );

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_profit_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_profit_overrides_updated_at
  BEFORE UPDATE ON quote_profit_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_profit_overrides_updated_at();

