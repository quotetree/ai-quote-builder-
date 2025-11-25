-- Add Stripe-related fields to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

-- Add Stripe subscription ID and cancellation flag to subscriptions table
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS stripe_price_id TEXT,
ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id ON profiles(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);

-- Add comment
COMMENT ON COLUMN profiles.stripe_customer_id IS 'Stripe Customer ID for billing';
COMMENT ON COLUMN subscriptions.stripe_subscription_id IS 'Stripe Subscription ID';
COMMENT ON COLUMN subscriptions.stripe_price_id IS 'Stripe Price ID for the base plan';

