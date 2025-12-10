-- Migration: Allow organization members to view each other's profiles
-- This enables PDF generation and other features that need to access
-- org member profiles for branding, avatars, etc.

-- Add policy for org members to view profiles in their organization
CREATE POLICY "Org members can view org member profiles"
  ON profiles FOR SELECT
  USING (
    id IN (
      SELECT om.user_id
      FROM organization_memberships om
      WHERE om.organization_id IN (
        SELECT organization_id
        FROM organization_memberships
        WHERE user_id = auth.uid()
      )
    )
  );

-- This policy allows:
-- - Users in the same organization to view each other's profiles
-- - Enables PDF generation to access owner's company branding
-- - Enables member management UIs to display member info
-- - Does NOT allow viewing profiles outside the organization

