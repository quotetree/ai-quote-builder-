-- Sync your current subscription data with Stripe
-- Based on screenshot 1: Organization Yearly with 5 additional licenses (8 total)
-- Cancels Dec 3, 2026
-- $6,264.00 per year = $522/month

-- Your current plan should be:
-- Base: 3 licenses (Organization Base)
-- Additional: 5 licenses
-- Total: 8 licenses (but screenshot shows 5 user licenses - need to clarify)

-- Let's check what's currently in the database
SELECT 
  id,
  organization_id,
  plan_type,
  billing_cycle,
  base_licenses,
  additional_licenses,
  base_licenses + additional_licenses as total_licenses,
  base_price_cents,
  additional_license_price_cents,
  (base_price_cents + (additional_licenses * additional_license_price_cents)) as total_monthly_cost_cents,
  current_period_end,
  status,
  stripe_subscription_id
FROM subscriptions
WHERE stripe_subscription_id IS NOT NULL
ORDER BY updated_at DESC
LIMIT 1;

-- If the above shows incorrect data, run this update:
-- Based on Stripe Customer Portal showing:
-- - Organization Yearly Base (3 licenses included) = $19700/month ($197/mo equivalent)
-- - 2 Additional Licenses × $6500/month ($65/mo equivalent each)
-- Total: 5 licenses, $32700/month ($327/mo)

UPDATE subscriptions
SET
  plan_type = 'organization',
  billing_cycle = 'yearly',
  base_licenses = 3,
  additional_licenses = 2,  -- This gives you 5 total licenses
  base_price_cents = 19700,  -- $197/month equivalent for yearly org base
  additional_license_price_cents = 6500,  -- $65/month equivalent for yearly additional
  -- Total monthly equivalent: $327 (which matches your billing card in screenshot 3)
  updated_at = NOW()
WHERE stripe_subscription_id IS NOT NULL;

-- Verify the update
SELECT 
  plan_type,
  billing_cycle,
  base_licenses,
  additional_licenses,
  (base_licenses + additional_licenses) as total_licenses,
  base_price_cents / 100.0 as base_price_dollars,
  additional_license_price_cents / 100.0 as additional_license_price_dollars,
  (base_price_cents + (additional_licenses * additional_license_price_cents)) / 100.0 as total_monthly_dollars,
  current_period_end,
  status
FROM subscriptions
WHERE stripe_subscription_id IS NOT NULL;

-- Expected result after update:
-- plan_type: organization
-- billing_cycle: yearly
-- base_licenses: 3
-- additional_licenses: 2
-- total_licenses: 5
-- base_price_dollars: 197.00
-- additional_license_price_dollars: 65.00
-- total_monthly_dollars: 327.00

