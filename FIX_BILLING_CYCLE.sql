-- Fix subscription billing cycle and pricing for yearly organization plan
-- Run this in your Supabase SQL Editor

-- This will update your subscription to:
-- - Change billing_cycle from "monthly" to "yearly"
-- - Update base_price_cents from 24500 ($245) to 19700 ($197)
-- - Update additional_license_price_cents from 7900 ($79) to 6500 ($65)
-- 
-- Result: Total cost will be $327/month (base $197 + 2 licenses × $65)
-- Billed yearly at $3,924/year

UPDATE subscriptions
SET 
  billing_cycle = 'yearly',
  base_price_cents = 19700,  -- $197/month for yearly org base
  additional_license_price_cents = 6500,  -- $65/month for yearly additional licenses
  updated_at = NOW()
WHERE 
  plan_type = 'organization'
  AND billing_cycle = 'monthly'  -- Only update if currently set to monthly
  AND stripe_subscription_id IS NOT NULL;  -- Make sure it has a Stripe subscription

-- Verify the update
SELECT 
  id,
  organization_id,
  plan_type,
  billing_cycle,
  base_licenses,
  additional_licenses,
  total_licenses,
  base_price_cents,
  additional_license_price_cents,
  (base_price_cents + (additional_licenses * additional_license_price_cents)) as total_monthly_cost,
  stripe_subscription_id,
  status,
  updated_at
FROM subscriptions
WHERE plan_type = 'organization'
ORDER BY updated_at DESC
LIMIT 1;

-- Expected result after running this:
-- billing_cycle: yearly
-- base_price_cents: 19700
-- additional_license_price_cents: 6500
-- total_monthly_cost: 32700 (which displays as $327.00)

