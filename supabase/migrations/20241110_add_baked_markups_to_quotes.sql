-- Add bakedMarkups column to quotes table to persist markup configurations
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS baked_markups JSONB DEFAULT '[]';

-- Add index for queries that filter by baked markups
CREATE INDEX IF NOT EXISTS idx_quotes_baked_markups ON quotes USING GIN (baked_markups);

-- Add comment explaining the column
COMMENT ON COLUMN quotes.baked_markups IS 'Array of BakedMarkupConfig objects containing markup rules with base/addTo selectors, distribution methods, and computed per-item deltas';

