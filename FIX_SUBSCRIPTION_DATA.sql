-- ========================================
-- FIX SUBSCRIPTION DATA
-- ========================================
-- This script fixes incorrect subscription data in the database
-- to match what's actually in Stripe

-- STEP 1: View current subscription data
SELECT 
  id,
  plan_type,
  billing_cycle,
  status,
  base_licenses,
  additional_licenses,
  total_licenses,
  base_price_cents,
  additional_license_price_cents,
  stripe_subscription_id,
  updated_at
FROM subscriptions
ORDER BY updated_at DESC;

-- STEP 2: Fix Individual Monthly Plan
-- If you have an Individual Monthly plan, it should have:
-- - base_licenses = 1 (not 3)
-- - base_price_cents = 9700 ($97.00, not $245.00)
-- - additional_license_price_cents = 0 (not 7900)

UPDATE subscriptions
SET 
  base_licenses = 1,
  base_price_cents = 9700,
  additional_license_price_cents = 0,
  additional_licenses = 0,
  updated_at = NOW()
WHERE plan_type = 'individual' 
  AND billing_cycle = 'monthly'
  AND (base_licenses != 1 OR base_price_cents != 9700);

-- STEP 3: Fix Individual Yearly Plan
UPDATE subscriptions
SET 
  base_licenses = 1,
  base_price_cents = 7900,
  additional_license_price_cents = 0,
  additional_licenses = 0,
  updated_at = NOW()
WHERE plan_type = 'individual' 
  AND billing_cycle = 'yearly'
  AND (base_licenses != 1 OR base_price_cents != 7900);

-- STEP 4: Fix Organization Monthly Plan
UPDATE subscriptions
SET 
  base_licenses = 3,
  base_price_cents = 24500,
  additional_license_price_cents = 7900,
  updated_at = NOW()
WHERE plan_type = 'organization' 
  AND billing_cycle = 'monthly'
  AND (base_licenses != 3 OR base_price_cents != 24500);

-- STEP 5: Fix Organization Yearly Plan
UPDATE subscriptions
SET 
  base_licenses = 3,
  base_price_cents = 19700,
  additional_license_price_cents = 6500,
  updated_at = NOW()
WHERE plan_type = 'organization' 
  AND billing_cycle = 'yearly'
  AND (base_licenses != 3 OR base_price_cents != 19700);

-- STEP 6: Verify all subscriptions are now correct
SELECT 
  id,
  plan_type,
  billing_cycle,
  status,
  base_licenses,
  additional_licenses,
  total_licenses,
  base_price_cents,
  additional_license_price_cents,
  CASE 
    WHEN plan_type = 'individual' AND billing_cycle = 'monthly' 
      THEN base_licenses = 1 AND base_price_cents = 9700
    WHEN plan_type = 'individual' AND billing_cycle = 'yearly' 
      THEN base_licenses = 1 AND base_price_cents = 7900
    WHEN plan_type = 'organization' AND billing_cycle = 'monthly' 
      THEN base_licenses = 3 AND base_price_cents = 24500
    WHEN plan_type = 'organization' AND billing_cycle = 'yearly' 
      THEN base_licenses = 3 AND base_price_cents = 19700
    ELSE false
  END as is_correct
FROM subscriptions
ORDER BY updated_at DESC;

