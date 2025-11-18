-- Add unfulfilled requests tracking to project working state
ALTER TABLE project_working_state
ADD COLUMN IF NOT EXISTS unfulfilled_requests JSONB DEFAULT '[]';


