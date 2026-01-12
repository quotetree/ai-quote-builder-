-- Create trial_inquiries table to store lead information from free trial popup
CREATE TABLE IF NOT EXISTS public.trial_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company_name TEXT,
  stripe_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trial_inquiries_email ON public.trial_inquiries(email);
CREATE INDEX IF NOT EXISTS idx_trial_inquiries_created_at ON public.trial_inquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trial_inquiries_stripe_session_id ON public.trial_inquiries(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE public.trial_inquiries ENABLE ROW LEVEL SECURITY;

-- Create policy for service role to insert and read (for API endpoint)
CREATE POLICY "Service role can insert trial inquiries"
  ON public.trial_inquiries
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can read trial inquiries"
  ON public.trial_inquiries
  FOR SELECT
  TO service_role
  USING (true);

-- Create policy for authenticated users (admins) to read all inquiries
CREATE POLICY "Authenticated users can read trial inquiries"
  ON public.trial_inquiries
  FOR SELECT
  TO authenticated
  USING (true);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.trial_inquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Add comment to table
COMMENT ON TABLE public.trial_inquiries IS 'Stores contact information from users who click free trial CTAs before being redirected to Stripe checkout';

