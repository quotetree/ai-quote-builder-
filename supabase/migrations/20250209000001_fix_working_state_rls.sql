-- Fix RLS policy on project_working_state table
-- Make it org-centric so all org members can access it

-- Drop old user-centric policy
DROP POLICY IF EXISTS "Users can manage their own project working state" ON project_working_state;

-- Create new org-centric policy
-- All org members can manage working state for their org's projects
CREATE POLICY "Org members can manage project working state"
  ON project_working_state FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_working_state.project_id
        AND om.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      INNER JOIN organization_memberships om ON p.organization_id = om.organization_id
      WHERE p.id = project_working_state.project_id
        AND om.user_id = auth.uid()
    )
  );

-- Keep the shared project policy for external sharing
-- (already exists: "Org members can manage shared project working state")

