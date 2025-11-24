-- Add workspace settings: organizations, memberships, and subscriptions
-- This migration supports multi-tier plans: Free (trial), Individual, and Organization

-- ============================================
-- 1. ORGANIZATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organizations_owner_id ON organizations(owner_id);

-- ============================================
-- 2. ORGANIZATION MEMBERSHIPS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'super_admin', 'admin')),
  invited_by UUID REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

CREATE INDEX idx_org_memberships_org_id ON organization_memberships(organization_id);
CREATE INDEX idx_org_memberships_user_id ON organization_memberships(user_id);

-- ============================================
-- 3. SUBSCRIPTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('free', 'individual', 'organization')),
  billing_cycle TEXT CHECK (billing_cycle IN ('monthly', 'yearly')),
  status TEXT NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'expired')) DEFAULT 'trialing',
  trial_start_date TIMESTAMPTZ,
  trial_end_date TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  -- License management for organization plan
  base_licenses INT NOT NULL DEFAULT 1, -- Individual: 1, Organization: 3
  additional_licenses INT NOT NULL DEFAULT 0,
  total_licenses INT GENERATED ALWAYS AS (base_licenses + additional_licenses) STORED,
  -- Pricing (in cents for precision)
  base_price_cents INT NOT NULL DEFAULT 0,
  additional_license_price_cents INT NOT NULL DEFAULT 0,
  -- Stripe integration (for future use)
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_org_id ON subscriptions(organization_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);

-- ============================================
-- 4. PENDING INVITATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin')),
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  invitation_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')) DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_invitations_org_id ON organization_invitations(organization_id);
CREATE INDEX idx_org_invitations_email ON organization_invitations(email);
CREATE INDEX idx_org_invitations_token ON organization_invitations(invitation_token);
CREATE INDEX idx_org_invitations_status ON organization_invitations(status);

-- ============================================
-- 5. UPDATE TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_org_memberships_updated_at
  BEFORE UPDATE ON organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_org_invitations_updated_at
  BEFORE UPDATE ON organization_invitations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 6. ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;

-- Organizations: Users can read orgs they're members of
CREATE POLICY "Users can view their organizations"
  ON organizations FOR SELECT
  USING (
    id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Organizations: Only owners can update their organization
CREATE POLICY "Owners can update their organization"
  ON organizations FOR UPDATE
  USING (owner_id = auth.uid());

-- Organization Memberships: Users can view memberships in their orgs
CREATE POLICY "Users can view memberships in their organizations"
  ON organization_memberships FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Organization Memberships: Owners and super_admins can insert memberships
CREATE POLICY "Owners and super_admins can add members"
  ON organization_memberships FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'super_admin')
    )
  );

-- Organization Memberships: Owners and super_admins can update/delete memberships
CREATE POLICY "Owners and super_admins can manage members"
  ON organization_memberships FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'super_admin')
    )
  );

CREATE POLICY "Owners and super_admins can remove members"
  ON organization_memberships FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'super_admin')
    )
  );

-- Subscriptions: Users can view subscriptions for their orgs
CREATE POLICY "Users can view their organization subscription"
  ON subscriptions FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Subscriptions: Only owners can update subscriptions
CREATE POLICY "Owners can update their subscription"
  ON subscriptions FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Invitations: Users can view invitations in their orgs
CREATE POLICY "Users can view invitations in their organizations"
  ON organization_invitations FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Invitations: Owners and super_admins can manage invitations
CREATE POLICY "Owners and super_admins can manage invitations"
  ON organization_invitations FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'super_admin')
    )
  );

-- ============================================
-- 7. MIGRATE EXISTING USERS
-- ============================================
-- Create a default organization for each existing user
DO $$
DECLARE
  user_record RECORD;
  new_org_id UUID;
  trial_start TIMESTAMPTZ := NOW();
  trial_end TIMESTAMPTZ := NOW() + INTERVAL '30 days';
BEGIN
  FOR user_record IN 
    SELECT id, email FROM auth.users
  LOOP
    -- Create organization for user
    INSERT INTO organizations (owner_id, name, created_at, updated_at)
    VALUES (
      user_record.id,
      COALESCE(
        (SELECT company_name FROM profiles WHERE id = user_record.id),
        SPLIT_PART(user_record.email, '@', 1) || '''s Workspace'
      ),
      NOW(),
      NOW()
    )
    RETURNING id INTO new_org_id;
    
    -- Create membership for user as owner
    INSERT INTO organization_memberships (
      organization_id,
      user_id,
      role,
      joined_at,
      created_at,
      updated_at
    )
    VALUES (
      new_org_id,
      user_record.id,
      'owner',
      NOW(),
      NOW(),
      NOW()
    );
    
    -- Create free trial subscription
    INSERT INTO subscriptions (
      organization_id,
      plan_type,
      status,
      trial_start_date,
      trial_end_date,
      current_period_start,
      current_period_end,
      base_licenses,
      additional_licenses,
      base_price_cents,
      additional_license_price_cents,
      created_at,
      updated_at
    )
    VALUES (
      new_org_id,
      'free',
      'trialing',
      trial_start,
      trial_end,
      trial_start,
      trial_end,
      1,
      0,
      0,
      0,
      NOW(),
      NOW()
    );
  END LOOP;
END $$;

-- ============================================
-- 8. UPDATE EXISTING TABLES TO REFERENCE ORGANIZATIONS
-- ============================================
-- We'll keep user_id for backwards compatibility but add organization_id

-- Add organization_id to projects table if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'projects' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE projects ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
    
    -- Populate organization_id for existing projects
    UPDATE projects p
    SET organization_id = (
      SELECT om.organization_id 
      FROM organization_memberships om 
      WHERE om.user_id = p.user_id 
      LIMIT 1
    )
    WHERE organization_id IS NULL;
    
    -- Make organization_id NOT NULL after population
    ALTER TABLE projects ALTER COLUMN organization_id SET NOT NULL;
    
    -- Add index
    CREATE INDEX idx_projects_organization_id ON projects(organization_id);
  END IF;
END $$;

-- Add organization_id to products table if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE products ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
    
    -- Populate organization_id for existing products
    UPDATE products p
    SET organization_id = (
      SELECT om.organization_id 
      FROM organization_memberships om 
      WHERE om.user_id = p.user_id 
      LIMIT 1
    )
    WHERE organization_id IS NULL;
    
    -- Make organization_id NOT NULL after population
    ALTER TABLE products ALTER COLUMN organization_id SET NOT NULL;
    
    -- Add index
    CREATE INDEX idx_products_organization_id ON products(organization_id);
  END IF;
END $$;

-- Add organization_id to product_families table if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'product_families' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE product_families ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
    
    -- Populate organization_id for existing product families
    UPDATE product_families pf
    SET organization_id = (
      SELECT om.organization_id 
      FROM organization_memberships om 
      WHERE om.user_id = pf.user_id 
      LIMIT 1
    )
    WHERE organization_id IS NULL;
    
    -- Make organization_id NOT NULL after population
    ALTER TABLE product_families ALTER COLUMN organization_id SET NOT NULL;
    
    -- Add index
    CREATE INDEX idx_product_families_organization_id ON product_families(organization_id);
  END IF;
END $$;

-- Add organization_id to quotes table if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quotes' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE quotes ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
    
    -- Populate organization_id for existing quotes
    UPDATE quotes q
    SET organization_id = (
      SELECT om.organization_id 
      FROM organization_memberships om 
      WHERE om.user_id = q.user_id 
      LIMIT 1
    )
    WHERE organization_id IS NULL;
    
    -- Make organization_id NOT NULL after population
    ALTER TABLE quotes ALTER COLUMN organization_id SET NOT NULL;
    
    -- Add index
    CREATE INDEX idx_quotes_organization_id ON quotes(organization_id);
  END IF;
END $$;

-- ============================================
-- 9. HELPER FUNCTIONS
-- ============================================

-- Function to get user's organization membership
CREATE OR REPLACE FUNCTION get_user_organization_membership(p_user_id UUID)
RETURNS TABLE (
  organization_id UUID,
  organization_name TEXT,
  role TEXT,
  plan_type TEXT,
  subscription_status TEXT,
  total_licenses INT,
  used_licenses BIGINT,
  available_licenses INT,
  trial_end_date TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id AS organization_id,
    o.name AS organization_name,
    om.role,
    s.plan_type,
    s.status AS subscription_status,
    s.total_licenses,
    (SELECT COUNT(*) FROM organization_memberships WHERE organization_id = o.id) AS used_licenses,
    (s.total_licenses - (SELECT COUNT(*) FROM organization_memberships WHERE organization_id = o.id))::INT AS available_licenses,
    s.trial_end_date
  FROM organization_memberships om
  JOIN organizations o ON om.organization_id = o.id
  JOIN subscriptions s ON o.id = s.organization_id
  WHERE om.user_id = p_user_id
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user can manage price book
CREATE OR REPLACE FUNCTION can_user_manage_pricebook(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE user_id = p_user_id 
    AND role IN ('owner', 'super_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user can invite members
CREATE OR REPLACE FUNCTION can_user_invite_members(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE user_id = p_user_id 
    AND role IN ('owner', 'super_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

