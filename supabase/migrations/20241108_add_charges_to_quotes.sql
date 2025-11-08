-- Add charges column to quotes table to persist tax/fee configurations
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS charges JSONB DEFAULT '[]';

-- Add index for queries that filter by charges
CREATE INDEX IF NOT EXISTS idx_quotes_charges ON quotes USING GIN (charges);

-- Add comment explaining the column
COMMENT ON COLUMN quotes.charges IS 'Array of ChargeConfig objects containing tax/fee configurations with rates, selectors, and computed amounts';

