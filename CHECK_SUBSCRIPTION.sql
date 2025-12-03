-- Run this in Supabase SQL Editor to check your current subscription
-- This will show you if the subscription was actually updated by the webhook

SELECT 
  s.id as subscription_id,
  s.organization_id,
  s.plan_type,
  s.billing_cycle,
  s.status,
  s.base_licenses,
  s.additional_licenses,
  s.total_licenses,
  s.stripe_subscription_id,
  s.current_period_start,
  s.current_period_end,
  s.trial_end_date,
  s.updated_at,
  o.name as organization_name
FROM subscriptions s
JOIN organizations o ON o.id = s.organization_id
ORDER BY s.updated_at DESC
LIMIT 5;

