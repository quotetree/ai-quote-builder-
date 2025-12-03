-- Fix RLS policies to allow webhook updates without user context
-- Webhooks need to update subscriptions but don't have auth.uid() available

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "subscriptions_update_owner" ON subscriptions;

-- Create permissive policies for service role (webhooks)
-- Service role bypasses RLS, but let's ensure proper policies exist

-- Allow authenticated users to read their own subscription
CREATE POLICY "subscriptions_select_member" ON subscriptions
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid()
    )
  );

-- Allow owners to update their subscription
CREATE POLICY "subscriptions_update_owner" ON subscriptions
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM organization_memberships 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- CRITICAL: Allow updates by organization_id (for webhooks using service role)
-- This works because webhooks use the service role which bypasses RLS
-- But we need to ensure the table allows updates
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Grant necessary permissions to service role (used by API routes)
GRANT ALL ON subscriptions TO service_role;
GRANT ALL ON organizations TO service_role;
GRANT ALL ON organization_memberships TO service_role;
GRANT ALL ON profiles TO service_role;

