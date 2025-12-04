-- Add pending_plan_change column to subscriptions table
-- This column stores information about scheduled plan downgrades

ALTER TABLE subscriptions 
ADD COLUMN IF NOT EXISTS pending_plan_change JSONB DEFAULT NULL;

-- Add comment explaining the structure
COMMENT ON COLUMN subscriptions.pending_plan_change IS 
'Stores pending plan changes (downgrades) scheduled for next billing period. 
Structure: {
  "plan_type": "individual" | "organization",
  "billing_cycle": "monthly" | "yearly",
  "additional_licenses": number,
  "scheduled_for": ISO date string,
  "created_at": ISO date string
}';

-- Create index for efficient queries on pending changes
CREATE INDEX IF NOT EXISTS idx_subscriptions_pending_plan_change 
ON subscriptions ((pending_plan_change IS NOT NULL))
WHERE pending_plan_change IS NOT NULL;

