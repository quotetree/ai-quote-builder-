-- STEP 1: Check current subscription data in database
SELECT 
  s.id,
  s.organization_id,
  s.plan_type,
  s.billing_cycle,
  s.base_licenses,
  s.additional_licenses,
  (s.base_licenses + s.additional_licenses) as total_licenses,
  s.base_price_cents / 100.0 as base_price_dollars,
  s.additional_license_price_cents / 100.0 as additional_license_price_dollars,
  (s.base_price_cents + (s.additional_licenses * s.additional_license_price_cents)) / 100.0 as total_monthly_dollars,
  s.stripe_subscription_id,
  s.status,
  p.stripe_customer_id,
  p.email
FROM subscriptions s
JOIN organizations o ON s.organization_id = o.id
JOIN profiles p ON o.owner_id = p.id
WHERE s.stripe_subscription_id IS NOT NULL
ORDER BY s.updated_at DESC;

-- STEP 2: Check what's in Stripe (you'll need to manually verify this in Stripe Dashboard)
-- Go to: https://dashboard.stripe.com/subscriptions
-- Find your subscription and note:
-- - Plan type (Individual vs Organization)
-- - Billing cycle (Monthly vs Yearly)
-- - Number of licenses
-- - Monthly cost

-- STEP 3: Update to Individual Monthly $97 (if that's your real plan)
-- ONLY RUN THIS IF YOU HAVE INDIVIDUAL MONTHLY $97 PLAN
/*
UPDATE subscriptions
SET
  plan_type = 'individual',
  billing_cycle = 'monthly',
  base_licenses = 1,
  additional_licenses = 0,
  base_price_cents = 9700,  -- $97/month
  additional_license_price_cents = 0,
  updated_at = NOW()
WHERE stripe_subscription_id IS NOT NULL;
*/

-- STEP 4: If you have a different plan, uncomment and modify the appropriate one below:

-- For Individual Yearly $948/year ($79/month equivalent):
/*
UPDATE subscriptions
SET
  plan_type = 'individual',
  billing_cycle = 'yearly',
  base_licenses = 1,
  additional_licenses = 0,
  base_price_cents = 7900,  -- $79/month equivalent
  additional_license_price_cents = 0,
  updated_at = NOW()
WHERE stripe_subscription_id IS NOT NULL;
*/

-- For Organization Monthly (3 base licenses, no additional):
/*
UPDATE subscriptions
SET
  plan_type = 'organization',
  billing_cycle = 'monthly',
  base_licenses = 3,
  additional_licenses = 0,
  base_price_cents = 24500,  -- $245/month
  additional_license_price_cents = 7900,  -- $79/month per additional
  updated_at = NOW()
WHERE stripe_subscription_id IS NOT NULL;
*/

-- STEP 5: Verify the fix
SELECT 
  plan_type,
  billing_cycle,
  base_licenses,
  additional_licenses,
  (base_licenses + additional_licenses) as total_licenses,
  (base_price_cents + (additional_licenses * additional_license_price_cents)) / 100.0 as total_monthly_dollars,
  status
FROM subscriptions
WHERE stripe_subscription_id IS NOT NULL;

