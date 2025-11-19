-- Add conversation_state and current_pool_id columns to project_working_state table

-- 1. conversation_state: Stores the two-phase AI pipeline conversation context
ALTER TABLE project_working_state
ADD COLUMN IF NOT EXISTS conversation_state JSONB DEFAULT '{
  "lastRequestedItems": [],
  "accumulatedItems": [],
  "lastUserMessage": ""
}'::jsonb;

-- 2. current_pool_id: Tracks the current product suggestion pool for isolation
ALTER TABLE project_working_state
ADD COLUMN IF NOT EXISTS current_pool_id TEXT DEFAULT NULL;

-- Add comments explaining the columns
COMMENT ON COLUMN project_working_state.conversation_state IS 
'Conversation context for the two-phase AI pipeline. Stores lastRequestedItems (from previous message), accumulatedItems (running list of all discussed items), and lastUserMessage (for reference). Used for handling corrections like "not the 5-year license".';

COMMENT ON COLUMN project_working_state.current_pool_id IS 
'Current product suggestion pool ID for tracking and isolating product suggestions across different chat interactions.';

