-- Create table to store project working state (suggested products and preview quote)
-- This allows the suggested products and preview quote to persist across navigation
CREATE TABLE IF NOT EXISTS project_working_state (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL UNIQUE,
  suggested_products JSONB DEFAULT '[]',
  quote_preview JSONB DEFAULT NULL,
  show_split_view BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX idx_project_working_state_project_id ON project_working_state(project_id);

-- Enable RLS
ALTER TABLE project_working_state ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access working state for their own projects
CREATE POLICY "Users can manage their own project working state"
  ON project_working_state
  FOR ALL
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_project_working_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_update_project_working_state_updated_at
  BEFORE UPDATE ON project_working_state
  FOR EACH ROW
  EXECUTE FUNCTION update_project_working_state_updated_at();


