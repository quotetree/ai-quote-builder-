# Organization Model - Current State Analysis

## Executive Summary

The database schema already has organization support (`organizations`, `organization_memberships`, `organization_invitations`, `subscriptions`), and **organization_id** has been added to key tables (projects, quotes, products, product_families). However, there are critical gaps:

1. **❌ No email sending** - Invitations are stored in DB but never emailed to recipients
2. **❌ User-centric RLS** - Policies check `user_id` instead of `organization_id`, preventing org-wide collaboration
3. **❌ No invite acceptance flow** - No page/route to validate tokens and create memberships

## Database Schema

### 1. Organizations Table

**Location:** `supabase/migrations/20250123000000_add_workspace_settings.sql` (lines 7-15)

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Key Points:**
- Each org has one `owner_id` who created it
- Existing users automatically got orgs created via migration (lines 227-300)

### 2. Organization Memberships Table

**Location:** `supabase/migrations/20250123000000_add_workspace_settings.sql` (lines 20-34)

```sql
CREATE TABLE organization_memberships (
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
```

**Key Points:**
- Three roles: `owner`, `super_admin`, `admin`
- UNIQUE constraint prevents duplicate memberships
- Tracks who invited whom and when they joined

### 3. Organization Invitations Table

**Location:** `supabase/migrations/20250123000000_add_workspace_settings.sql` (lines 72-88)

```sql
CREATE TABLE organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin')),  -- ⚠️ Note: NO 'owner'
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  invitation_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')) DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Key Points:**
- ✅ Table structure is correct with `invitation_token` and `status` fields
- ✅ Role constraint already prevents inviting as 'owner' (only 'super_admin' or 'admin')
- ❌ **GAP:** No code actually sends emails when invites are created
- ❌ **GAP:** No page/route to accept invites via token

### 4. Subscriptions Table

**Location:** `supabase/migrations/20250123000000_add_workspace_settings.sql` (lines 39-67)

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('free', 'individual', 'organization')),
  billing_cycle TEXT CHECK (billing_cycle IN ('monthly', 'yearly')),
  status TEXT NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'expired')) DEFAULT 'trialing',
  trial_start_date TIMESTAMPTZ,
  trial_end_date TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  base_licenses INT NOT NULL DEFAULT 1,
  additional_licenses INT NOT NULL DEFAULT 0,
  total_licenses INT GENERATED ALWAYS AS (base_licenses + additional_licenses) STORED,
  -- Pricing & Stripe fields...
);
```

**Key Points:**
- Each org has exactly one subscription (UNIQUE constraint on organization_id)
- License tracking: base_licenses + additional_licenses = total_licenses
- Organization plan default: 2 base licenses (updated from 3)

### 5. Projects Table

**Location:** `supabase/schema.sql` (lines 54-64) + Migration added `organization_id`

```sql
CREATE TABLE projects (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL, -- Added by migration
  project_name TEXT NOT NULL,
  product_families UUID[],
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  share_token TEXT UNIQUE,
  share_token_created_at TIMESTAMPTZ
);
```

**Key Points:**
- Has BOTH `user_id` (creator) and `organization_id` (org owner)
- Migration populated `organization_id` from user's org membership (lines 307-332)

### 6. Quotes Table

**Location:** `supabase/schema.sql` (lines 112-131) + Migration added `organization_id`

```sql
CREATE TABLE quotes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL, -- Added by migration
  quote_number TEXT NOT NULL,
  quote_name TEXT NOT NULL,
  version_number INTEGER DEFAULT 1,
  status TEXT DEFAULT 'draft',
  -- ... pricing fields ...
);
```

**Key Points:**
- Has BOTH `user_id` (creator) and `organization_id` (org owner)
- Migration populated `organization_id` from user's org membership (lines 388-413)

### 7. Products & Product Families Tables

**Location:** `supabase/schema.sql` (lines 25-51) + Migration added `organization_id`

Both tables have:
- `user_id` (creator)
- `organization_id` (org owner) - added by migration
- Populated via migration lines 334-386

## Current RLS Policies

### ❌ Problem: User-Centric Policies

**Projects RLS** (schema.sql lines 219-234):
```sql
-- ❌ Only shows projects where YOU are the creator
CREATE POLICY "Users can view own projects" 
  ON projects FOR SELECT 
  USING (auth.uid() = user_id);

-- ❌ Only allows creating projects under YOUR user_id
CREATE POLICY "Users can insert own projects" 
  ON projects FOR INSERT 
  WITH CHECK (auth.uid() = user_id);
```

**Quotes RLS** (schema.sql lines 246-252):
```sql
-- ❌ Only shows quotes where YOU are the creator
CREATE POLICY "Users can view own quotes" 
  ON quotes FOR SELECT 
  USING (auth.uid() = user_id);
```

**Products RLS** (schema.sql lines 207-210):
```sql
-- ❌ Only shows products where YOU are the creator
CREATE POLICY "Users can view own products" 
  ON products FOR SELECT 
  USING (auth.uid() = user_id);
```

### ✅ What Works: Organization Tables

**Organizations** (migration lines 129-142):
```sql
-- ✅ Good: Members can view their org
CREATE POLICY "Users can view their organizations"
  ON organizations FOR SELECT
  USING (
    id IN (
      SELECT organization_id FROM organization_memberships
      WHERE user_id = auth.uid()
    )
  );

-- ✅ Good: Only owner can update
CREATE POLICY "Owners can update their organization"
  ON organizations FOR UPDATE
  USING (owner_id = auth.uid());
```

**Organization Memberships** (migration lines 144-181):
- ✅ Members can view memberships in their org
- ✅ Owners + super_admins can add/remove members
- ✅ Role-based access control working correctly

**Subscriptions** (migration lines 183-201):
- ✅ Members can view their org's subscription
- ✅ Only owners can update subscription

**Invitations** (migration lines 203-221):
- ✅ Members can view invitations in their org
- ✅ Owners + super_admins can manage invitations

## How Invites Currently Work (Partially)

### What Exists:
1. **Table structure**: `organization_invitations` has all needed fields
2. **RLS policies**: Owners/super_admins can INSERT/UPDATE/DELETE invitations
3. **Helper function**: `can_user_invite_members()` checks permissions (lines 464-474)

### What's Missing:
1. **❌ No API route** to create invitations and send emails
2. **❌ No email sending** when invitation is created
3. **❌ No accept-invite page** to validate tokens
4. **❌ No token-to-membership flow** to convert pending invites to active members

### Current Frontend:
- `components/MembersModal.tsx` exists and shows members
- **Likely** has an invite UI but it doesn't connect to a working backend
- Need to verify what API it calls (if any)

## Resend Integration

### ✅ What Exists:
- **Package installed**: `resend: ^6.5.2` in package.json
- **Example implementation**: `lib/email/welcomeEmail.ts`
  - Uses `new Resend(process.env.RESEND_API_KEY)`
  - Sends HTML emails via `resend.emails.send()`
  - From address: `sam@quotetree.ai`

### Pattern to Follow:
```typescript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: 'Sam from QuoteTree <sam@quotetree.ai>',
  to: [email],
  subject: 'Subject line',
  html: htmlContent,
});
```

## Helper Functions (Already Exist)

**Location:** `supabase/migrations/20250123000000_add_workspace_settings.sql` (lines 419-474)

```sql
-- ✅ Get user's org membership info
CREATE FUNCTION get_user_organization_membership(p_user_id UUID)
RETURNS TABLE (organization_id UUID, role TEXT, ...);

-- ✅ Check if user can manage price book
CREATE FUNCTION can_user_manage_pricebook(p_user_id UUID)
RETURNS BOOLEAN; -- Returns true for owner/super_admin

-- ✅ Check if user can invite members
CREATE FUNCTION can_user_invite_members(p_user_id UUID)
RETURNS BOOLEAN; -- Returns true for owner/super_admin
```

## Summary of Gaps

### Phase 2 Gaps (Invite Flow):
1. ❌ No POST `/api/organizations/[id]/invites` route
2. ❌ No email template for invites
3. ❌ No `app/auth/accept-invite/page.tsx`
4. ❌ Need to connect MembersModal invite UI to new API

### Phase 3 Gaps (RLS):
1. ❌ Projects RLS is user-centric, not org-centric
2. ❌ Quotes RLS is user-centric, not org-centric
3. ❌ Products RLS needs role-based restrictions (owner/super_admin can edit, admin read-only)
4. ❌ Product Families RLS needs same treatment

### Phase 4 Gaps (Frontend):
1. ❌ Price book needs role-based UI restrictions
2. ✅ Settings restrictions already implemented (previous work)

## Migration Strategy

### Safe Approach:
1. Create NEW migration file: `supabase/migrations/YYYYMMDD_org_centric_rls.sql`
2. Drop old user-centric policies
3. Create new org-centric policies
4. Test locally before production

### Deployment Order:
1. ✅ Phase 1: Documentation (this file)
2. Next: Phase 2 (Invite flow with emails)
3. Then: Phase 3 (Fix RLS policies)
4. Finally: Phase 4 (Frontend guardrails)

## Environment Variables Needed

```env
# Already configured:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Need to verify/add:
RESEND_API_KEY=...  # For sending invite emails
NEXT_PUBLIC_APP_URL=https://quotetree.ai  # For invite links
```

---

**Status:** Phase 1 Complete ✅  
**Next:** Phase 2 - Build invite flow with email sending

