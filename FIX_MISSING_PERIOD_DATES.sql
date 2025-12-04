-- Fix missing current_period_start and current_period_end dates
-- These dates should be set by webhooks but are currently NULL
-- This causes proration calculations to fail

-- For testing purposes, let's set them manually
-- Assuming your subscription started around when you last made a purchase

UPDATE subscriptions
SET 
  current_period_start = NOW() - INTERVAL '7 days',  -- Adjust if needed
  current_period_end = NOW() + INTERVAL '358 days',  -- For yearly: ~1 year from start
  updated_at = NOW()
WHERE 
  stripe_subscription_id IS NOT NULL
  AND current_period_start IS NULL
  AND billing_cycle = 'yearly';

-- For monthly subscriptions (if any)
UPDATE subscriptions
SET 
  current_period_start = NOW() - INTERVAL '7 days',
  current_period_end = NOW() + INTERVAL '23 days',  -- For monthly: ~1 month from start
  updated_at = NOW()
WHERE 
  stripe_subscription_id IS NOT NULL
  AND current_period_start IS NULL
  AND billing_cycle = 'monthly';

-- Verify the update
SELECT 
  id,
  plan_type,
  billing_cycle,
  current_period_start,
  current_period_end,
  EXTRACT(DAY FROM (current_period_end - NOW())) as days_remaining,
  stripe_subscription_id,
  status
FROM subscriptions
WHERE stripe_subscription_id IS NOT NULL
ORDER BY updated_at DESC;

-- Note: The webhook should populate these dates automatically.
-- If they're still NULL after purchases, check the webhook handler logs.

