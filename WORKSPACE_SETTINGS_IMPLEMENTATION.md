# Workspace Settings Multi-Tier Implementation

## Overview

This implementation adds a complete multi-tier subscription system to QuoteTree with three plans: **Free Trial**, **Individual**, and **Organization**. It includes organization management, team member invitations, role-based permissions, and billing management (UI/DB structure ready for Stripe integration).

## Features Implemented

### 1. Multi-Tier Plans

#### Free Plan (30-day Trial)
- Full access to all features for 30 days
- 1 license included
- Automatically created for all new users
- Existing users migrated to free trial

#### Individual Plan
- **Monthly**: $97/month
- **Yearly**: $79/month (billed annually, saves ~20%)
- 1 license
- Full access to all features
- No team collaboration

#### Organization Plan
- **Monthly**: $245/month base + $79/month per additional license
- **Yearly**: $197/month base + $65/month per additional license (billed annually)
- 3 licenses included
- Unlimited additional licenses
- Shared price book across team
- Role-based permissions
- Team collaboration features

### 2. Role-Based Access Control

#### Owner
- Created the account and pays the bill
- Full access to everything including billing management
- Can add products to price book
- Can add/edit projects
- Can invite and manage team members
- Can change member roles

#### Super Admin
- Full access to projects and price book
- Can add products to price book
- Can add/edit projects
- Can invite and manage team members
- Cannot manage billing

#### Admin
- Can view, edit, and add new projects
- **View-only** access to price book (cannot add/edit/delete products)
- Cannot invite or manage team members
- Cannot manage billing

### 3. Database Schema

New tables created:

#### `organizations`
- Represents a workspace/company
- Each user gets their own organization
- Owner relationship tracked

#### `organization_memberships`
- Links users to organizations with roles
- Tracks invitation metadata
- Join date and invited_by tracked

#### `subscriptions`
- Tracks plan type and billing cycle
- License management (base + additional)
- Trial dates
- Pricing in cents for precision
- Stripe integration fields (for future use)

#### `organization_invitations`
- Pending email invitations
- Invitation tokens for acceptance links
- Expiration tracking (7 days)
- Status management (pending/accepted/expired/revoked)

### 4. UI Components

#### BillingModal (`components/BillingModal.tsx`)
- View current subscription plan
- Compare and select plans
- Toggle between monthly/yearly billing
- Add/remove additional licenses for org plan
- Trial status display
- Plan upgrade/downgrade
- Ready for Stripe payment integration

#### MembersModal (`components/MembersModal.tsx`)
- View all team members with roles
- License usage tracking
- Invite new members by email
- Remove team members
- Change member roles (owner only)
- View pending invitations
- Revoke pending invitations
- Role permission descriptions

#### Updated NewSidebar (`components/NewSidebar.tsx`)
- "Members" menu item (replaces "Workspace settings")
- "Billing" menu item (replaces "Add teammates")
- "Personalization" menu item (unchanged)

### 5. Permission System

Created `lib/permissions.ts` with helper functions:

```typescript
canManagePriceBook(role)      // Owner, Super Admin
canViewPriceBook(role)         // All roles
canManageMembers(role)         // Owner, Super Admin
canManageBilling(role)         // Owner only
canManageProjects(role)        // All roles
canViewProjects(role)          // All roles
canChangeRole(userRole, targetRole)
canRemoveMember(userRole, targetRole)
getRoleLabel(role)
getRoleDescription(role)
getPlanDisplayName(planType)
allowsMultipleMembers(planType)
getBaseLicenseCount(planType)
formatTrialDaysRemaining(trialEndDate)
isTrialExpired(trialEndDate)
canDowngradeTo(targetPlan, currentMemberCount)
```

### 6. Database Functions

Created PostgreSQL functions:

```sql
get_user_organization_membership(p_user_id UUID)
  -- Returns complete org context for a user
  
can_user_manage_pricebook(p_user_id UUID)
  -- Quick permission check for price book management
  
can_user_invite_members(p_user_id UUID)
  -- Quick permission check for member invitations
```

### 7. Row Level Security (RLS)

All tables have RLS policies:
- Users can only see data from organizations they're members of
- Owners and super admins can manage memberships
- Only owners can update subscriptions
- Invitations visible to all org members
- Only owners/super admins can manage invitations

## Migration Process

### Existing Users
All existing users are automatically:
1. Assigned to a new organization (using company_name or email-based name)
2. Set as the organization owner
3. Given a 30-day free trial subscription
4. Existing data (projects, products, quotes) linked to their organization

### New Users
1. Create auth account
2. Trigger creates profile
3. Organization created automatically
4. User added as owner
5. Free trial subscription started

## Invitation Flow

### Direct Addition (User Already Has QuoteTree Account)
1. Owner/Super Admin enters email in Members modal
2. System checks if user exists
3. If exists, user is immediately added to organization
4. User sees new organization in their workspace

### Email Invitation (New User)
1. Owner/Super Admin enters email in Members modal
2. Available license required before sending
3. Invitation record created with unique token
4. Email sent with invitation link (email integration TODO)
5. User clicks link and creates account
6. User automatically added to organization
7. Invitation marked as accepted

### License Management
- Cannot invite if no licenses available
- System shows: "X of Y licenses used, Z available"
- Must purchase additional licenses before inviting (org plan)
- Or upgrade to org plan (from individual)

## Pricing Structure

### Price Constants
Defined in `types/database.ts`:

```typescript
export const PLAN_PRICING = {
  individual: {
    monthly: 9700,  // $97.00 in cents
    yearly: 7900,   // $79.00 in cents (per month)
  },
  organization: {
    monthly: {
      base: 24500,                  // $245.00 in cents
      perAdditionalLicense: 7900,   // $79.00 in cents
    },
    yearly: {
      base: 19700,                  // $197.00 in cents (per month)
      perAdditionalLicense: 6500,   // $65.00 in cents (per month)
    },
    baseLicenses: 3,
  },
};
```

## Next Steps: Stripe Integration

The system is ready for Stripe integration. Here's what needs to be added:

### 1. Stripe Setup
- Create Stripe account
- Add Stripe API keys to environment variables
- Install Stripe SDK: `npm install stripe @stripe/stripe-js`

### 2. Create Stripe Products/Prices
- Individual Monthly ($97)
- Individual Yearly ($79/month, billed $948)
- Organization Monthly ($245 base + $79/license)
- Organization Yearly ($197/month base + $65/month license)

### 3. Update BillingModal
- Add Stripe checkout session creation
- Handle successful payment webhooks
- Update subscription status in database
- Add payment method management
- Show billing history

### 4. Webhooks
Create webhook handlers for:
- `checkout.session.completed` - Activate subscription
- `customer.subscription.updated` - Update subscription
- `customer.subscription.deleted` - Cancel subscription
- `invoice.payment_succeeded` - Record payment
- `invoice.payment_failed` - Handle failed payment

### 5. API Routes Needed
```
POST /api/stripe/create-checkout-session
POST /api/stripe/webhook
POST /api/stripe/create-portal-session
GET  /api/stripe/subscription-status
```

## Testing Checklist

### Database
- [ ] Run migration successfully
- [ ] Verify all tables created
- [ ] Verify RLS policies work
- [ ] Test helper functions
- [ ] Verify existing data migrated

### UI Components
- [ ] Billing modal displays correctly
- [ ] Members modal displays correctly
- [ ] Plan selection works
- [ ] License counter works
- [ ] Trial countdown shows
- [ ] Member invitation works
- [ ] Role changes work
- [ ] Member removal works

### Permissions
- [ ] Owner can access billing
- [ ] Super Admin cannot access billing
- [ ] Admin has read-only price book
- [ ] Owner/Super Admin can manage members
- [ ] Admin cannot manage members
- [ ] Cannot invite without licenses

### Edge Cases
- [ ] Trial expiration handling
- [ ] Downgrade with too many members blocked
- [ ] Owner cannot be removed
- [ ] Owner role cannot be changed
- [ ] Invitation expiration works
- [ ] Duplicate invitations blocked
- [ ] Already-member invitations blocked

## File Structure

```
quote-tree-ai/
├── supabase/
│   └── migrations/
│       └── 20250123000000_add_workspace_settings.sql
├── types/
│   └── database.ts (updated with new types + PLAN_PRICING)
├── components/
│   ├── BillingModal.tsx (new)
│   ├── MembersModal.tsx (new)
│   └── NewSidebar.tsx (updated)
├── lib/
│   └── permissions.ts (new)
└── WORKSPACE_SETTINGS_IMPLEMENTATION.md (this file)
```

## Configuration

No additional configuration needed at this stage. When adding Stripe:

```env
# .env.local
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Known Limitations

1. **Email invitations**: Database structure ready, but actual email sending not implemented
2. **Stripe payments**: UI/DB ready, but payment processing not integrated
3. **Trial expiration**: Warning shown, but no automatic account lockout
4. **Downgrade restrictions**: Warning shown, but force-downgrade not prevented at DB level

## Support

For questions or issues, refer to:
- Database schema: `supabase/migrations/20250123000000_add_workspace_settings.sql`
- Type definitions: `types/database.ts`
- Permission helpers: `lib/permissions.ts`
- UI components: `components/BillingModal.tsx`, `components/MembersModal.tsx`

