-- Update existing Individual plan subscriptions to new pricing
-- This updates trial subscriptions to use the new $79/month pricing
-- Run this in Supabase SQL Editor

-- Update Individual Monthly subscriptions from $97 to $79
UPDATE subscriptions
SET 
  base_price_cents = 7900,  -- $79.00 (was 9700)
  updated_at = NOW()
WHERE 
  plan_type = 'individual'
  AND billing_cycle = 'monthly'
  AND base_price_cents = 9700  -- Only update subscriptions with old pricing
  AND status IN ('trialing', 'active');

-- Update Individual Yearly subscriptions from $79 to $65
UPDATE subscriptions
SET 
  base_price_cents = 6500,  -- $65.00 per month (was 7900)
  updated_at = NOW()
WHERE 
  plan_type = 'individual'
  AND billing_cycle = 'yearly'
  AND base_price_cents = 7900  -- Only update subscriptions with old pricing
  AND status IN ('trialing', 'active');

-- Verify the changes
SELECT 
  id,
  organization_id,
  plan_type,
  billing_cycle,
  status,
  base_price_cents,
  base_price_cents / 100.0 as price_dollars,
  trial_end_date,
  updated_at
FROM subscriptions
WHERE plan_type = 'individual'
ORDER BY updated_at DESC;

