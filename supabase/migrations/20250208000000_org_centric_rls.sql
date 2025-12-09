-- Migration: Make RLS Policies Organization-Centric
-- This migration updates RLS policies to enable org-wide collaboration
-- All members of an organization can see/edit org projects, quotes, and products

-- ============================================
-- 1. PROJECTS TABLE - ORG-CENTRIC POLICIES
-- ============================================

-- Drop old user-centric policies
DROP POLICY IF EXISTS "Users can view own projects" ON projects;
DROP POLICY IF EXISTS "Users can insert own projects" ON projects;
DROP POLICY IF EXISTS "Users can update own projects" ON projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON projects;

-- Create new org-centric policies
-- SELECT: All org members can view org projects
CREATE POLICY "Org members can view org projects"
  ON projects FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- INSERT: All org members can create projects in their org
CREATE POLICY "Org members can create projects"
  ON projects FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- UPDATE: All org members can update org projects
CREATE POLICY "Org members can update org projects"
  ON projects FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- DELETE: All org members can delete org projects
CREATE POLICY "Org members can delete org projects"
  ON projects FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Keep existing shared project policy (for external sharing via share_token)
-- This policy already exists and doesn't conflict

-- ============================================
-- 2. QUOTES TABLE - ORG-CENTRIC POLICIES
-- ============================================

-- Drop old user-centric policies
DROP POLICY IF EXISTS "Users can view own quotes" ON quotes;
DROP POLICY IF EXISTS "Users can insert own quotes" ON quotes;
DROP POLICY IF EXISTS "Users can update own quotes" ON quotes;
DROP POLICY IF EXISTS "Users can delete own quotes" ON quotes;

-- Create new org-centric policies
-- SELECT: All org members can view org quotes
CREATE POLICY "Org members can view org quotes"
  ON quotes FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- INSERT: All org members can create quotes in their org
CREATE POLICY "Org members can create quotes"
  ON quotes FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- UPDATE: All org members can update org quotes
CREATE POLICY "Org members can update org quotes"
  ON quotes FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- DELETE: All org members can delete org quotes
CREATE POLICY "Org members can delete org quotes"
  ON quotes FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- Keep existing shared project quotes policy
-- This policy already exists for external sharing and doesn't conflict

-- ============================================
-- 3. PRODUCTS TABLE - ROLE-BASED POLICIES
-- ============================================

-- Drop old user-centric policies
DROP POLICY IF EXISTS "Users can view own products" ON products;
DROP POLICY IF EXISTS "Users can insert own products" ON products;
DROP POLICY IF EXISTS "Users can update own products" ON products;
DROP POLICY IF EXISTS "Users can delete own products" ON products;

-- Create new org-centric policies with role restrictions
-- SELECT: All org members can view org products (read-only for admin)
CREATE POLICY "Org members can view org products"
  ON products FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- INSERT: Only owner + super_admin can create products
CREATE POLICY "Owners and super_admins can create products"
  ON products FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'super_admin')
    )
  );

-- UPDATE: Only owner + super_admin can update products
CREATE POLICY "Owners and super_admins can update products"
  ON products FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'super_admin')
    )
  );

-- DELETE: Only owner + super_admin can delete products
CREATE POLICY "Owners and super_admins can delete products"
  ON products FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'super_admin')
    )
  );

-- ============================================
-- 4. PRODUCT_FAMILIES TABLE - ROLE-BASED POLICIES
-- ============================================

-- Drop old user-centric policies
DROP POLICY IF EXISTS "Users can view own families" ON product_families;
DROP POLICY IF EXISTS "Users can insert own families" ON product_families;
DROP POLICY IF EXISTS "Users can update own families" ON product_families;
DROP POLICY IF EXISTS "Users can delete own families" ON product_families;

-- Create new org-centric policies with role restrictions
-- SELECT: All org members can view org product families
CREATE POLICY "Org members can view org product families"
  ON product_families FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- INSERT: Only owner + super_admin can create product families
CREATE POLICY "Owners and super_admins can create product families"
  ON product_families FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'super_admin')
    )
  );

-- UPDATE: Only owner + super_admin can update product families
CREATE POLICY "Owners and super_admins can update product families"
  ON product_families FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'super_admin')
    )
  );

-- DELETE: Only owner + super_admin can delete product families
CREATE POLICY "Owners and super_admins can delete product families"
  ON product_families FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'super_admin')
    )
  );

-- ============================================
-- SUMMARY OF CHANGES
-- ============================================
-- 
-- BEFORE:
-- - Projects: Only visible/editable by creator (user_id check)
-- - Quotes: Only visible/editable by creator (user_id check)
-- - Products: Only visible/editable by creator (user_id check)
-- - Product Families: Only visible/editable by creator (user_id check)
--
-- AFTER:
-- - Projects: All org members can view/edit (organization_id check)
-- - Quotes: All org members can view/edit (organization_id check)
-- - Products: All members can view, only owner/super_admin can edit (role check)
-- - Product Families: All members can view, only owner/super_admin can edit (role check)
--
-- COLLABORATION MODEL:
-- - Owner: Full access to everything
-- - Super Admin: Full access to projects/quotes/products
-- - Admin: Full access to projects/quotes, read-only access to products
--
-- EXTERNAL SHARING:
-- - Existing share_token policies remain intact for external sharing
-- - Those policies use can_access_shared_project() function

