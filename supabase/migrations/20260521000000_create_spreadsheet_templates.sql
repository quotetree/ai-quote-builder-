-- User-saved spreadsheet templates
-- These are global to the user (not project-scoped) so they appear
-- across every project in the template strip.

CREATE TABLE spreadsheet_templates (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Template',
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  charges JSONB NOT NULL DEFAULT '[]'::jsonb,
  baked_markups JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_spreadsheet_templates_user_id ON spreadsheet_templates(user_id);

CREATE TRIGGER update_spreadsheet_templates_updated_at
  BEFORE UPDATE ON spreadsheet_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE spreadsheet_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own spreadsheet templates"
  ON spreadsheet_templates FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Org members can also view templates belonging to any member of the same org,
-- so shared workspaces get access to each other's saved templates.
CREATE POLICY "Org members can view teammates spreadsheet templates"
  ON spreadsheet_templates FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM organization_memberships om1
      JOIN organization_memberships om2
        ON om1.organization_id = om2.organization_id
      WHERE om1.user_id = auth.uid()
        AND om2.user_id = spreadsheet_templates.user_id
    )
  );
