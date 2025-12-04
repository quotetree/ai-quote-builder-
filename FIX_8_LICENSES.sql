-- Fix current subscription data to match Stripe (8 total licenses, yearly)
-- Base: 3 licenses (included)
-- Additional: 5 licenses
-- Total: 8 licenses
-- Monthly equivalent: $522/month
-- Yearly: $6,264/year

UPDATE subscriptions
SET
  plan_type = 'organization',
  billing_cycle = 'yearly',
  base_licenses = 3,
  additional_licenses = 5,  -- This gives you 8 total licenses
  base_price_cents = 19700,  -- $197/month equivalent for yearly org base
  additional_license_price_cents = 6500,  -- $65/month equivalent for yearly additional
  updated_at = NOW()
WHERE stripe_subscription_id IS NOT NULL;

-- Verify the fix
SELECT 
  plan_type,
  billing_cycle,
  base_licenses,
  additional_licenses,
  (base_licenses + additional_licenses) as total_licenses,
  (base_price_cents + (additional_licenses * additional_license_price_cents)) / 100.0 as total_monthly_dollars,
  current_period_end,
  status
FROM subscriptions
WHERE stripe_subscription_id IS NOT NULL;

-- Expected result:
-- plan_type: organization
-- billing_cycle: yearly
-- base_licenses: 3
-- additional_licenses: 5
-- total_licenses: 8
-- total_monthly_dollars: 522.00 (displayed as $522/month)
-- Billed yearly: $6,264/year

