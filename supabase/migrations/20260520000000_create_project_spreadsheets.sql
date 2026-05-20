-- Project Spreadsheets (Drive) — Phase 1: Estimate Spreadsheet feature
--
-- Follows the same org-centric RLS pattern established in
-- 20250209000000_fix_project_children_rls.sql

-- ============================================
-- TABLE
-- ============================================

CREATE TABLE project_spreadsheets (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  folder_id UUID REFERENCES project_folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Spreadsheet',
  -- NULL = blank; 'purchase_order' | 'invoice' | 'timesheet' = template
  template_id TEXT CHECK (template_id IN ('purchase_order', 'invoice', 'timesheet')),
  -- Array of { id, label, rows: [{ id, product_id, product_name, product_code,
  --   list_price, sales_price, quantity, custom_label }] }
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Reuses ChargeConfig[] type from the quote builder
  charges JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Reuses BakedMarkupConfig[] type from the quote builder
  baked_markups JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- LINK QUOTES → SPREADSHEETS
-- ============================================

ALTER TABLE quotes
  ADD COLUMN spreadsheet_id UUID REFERENCES project_spreadsheets(id) ON DELETE SET NULL;

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_project_spreadsheets_project_id ON project_spreadsheets(project_id);
CREATE INDEX idx_project_spreadsheets_folder_id ON project_spreadsheets(folder_id);
CREATE INDEX idx_quotes_spreadsheet_id ON quotes(spreadsheet_id);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================

CREATE TRIGGER update_project_spreadsheets_updated_at
  BEFORE UPDATE ON project_spreadsheets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE project_spreadsheets ENABLE ROW LEVEL SECURITY;

-- All org members can view spreadsheets in org projects
CREATE POLICY "Org members can view project spreadsheets"
  ON project_spreadsheets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_spreadsheets.project_id
        AND om.user_id = auth.uid()
    )
  );

-- All org members can insert spreadsheets into org projects
CREATE POLICY "Org members can insert project spreadsheets"
  ON project_spreadsheets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_spreadsheets.project_id
        AND om.user_id = auth.uid()
    )
  );

-- All org members can update spreadsheets in org projects
CREATE POLICY "Org members can update project spreadsheets"
  ON project_spreadsheets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_spreadsheets.project_id
        AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_spreadsheets.project_id
        AND om.user_id = auth.uid()
    )
  );

-- All org members can delete spreadsheets in org projects
CREATE POLICY "Org members can delete project spreadsheets"
  ON project_spreadsheets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_spreadsheets.project_id
        AND om.user_id = auth.uid()
    )
  );

-- External share-token access (mirrors pattern on notes/folders/documents)
CREATE POLICY "Shared project members can manage spreadsheets"
  ON project_spreadsheets FOR ALL
  USING (can_access_shared_project(project_id))
  WITH CHECK (can_access_shared_project(project_id));
