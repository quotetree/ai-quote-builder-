-- Add low_confidence_matches column to project_working_state table
-- This stores products with scores 1-49 that users can manually add to quote

ALTER TABLE project_working_state
ADD COLUMN IF NOT EXISTS low_confidence_matches JSONB DEFAULT '[]'::jsonb;

-- Add comment explaining the column
COMMENT ON COLUMN project_working_state.low_confidence_matches IS 
'Products with match confidence scores 1-49. Shown as "Possible Matches" with manual Add to Quote buttons. Not auto-added to suggested products.';

