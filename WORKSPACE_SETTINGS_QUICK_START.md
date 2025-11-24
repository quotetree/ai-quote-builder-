# Workspace Settings Quick Start Guide

## Getting Started

### 1. Apply the Database Migration

First, apply the migration to your Supabase database:

```bash
# If using Supabase CLI
supabase db push

# Or manually run the SQL file in Supabase Studio
# Go to SQL Editor and run: supabase/migrations/20250123000000_add_workspace_settings.sql
```

This will:
- Create new tables (organizations, organization_memberships, subscriptions, organization_invitations)
- Set up Row Level Security policies
- Migrate existing users to the new system
- Link existing projects, products, and quotes to organizations

### 2. Start Your Development Server

```bash
npm run dev
```

### 3. Test the New Features

#### Access Workspace Settings

1. Log in to your QuoteTree account
2. Click on your profile picture in the sidebar
3. You'll see the new menu:
   - **Personalization** (existing)
   - **Members** (new - replaces "Workspace settings")
   - **Billing** (new - replaces "Add teammates")

#### Test Billing Modal

1. Click **Billing** in the account menu
2. You should see:
   - "Free Trial Active" banner with days remaining
   - Current plan section showing "Free Trial"
   - Plan comparison cards (Individual and Organization)
   - Billing cycle toggle (Monthly/Yearly)
   - Pricing displayed correctly

**Try This:**
- Toggle between Monthly and Yearly billing
- Select the Individual plan - you'll see a success toast
- Select the Organization plan and adjust additional licenses
- Notice the pricing updates in real-time

#### Test Members Modal

1. Click **Members** in the account menu
2. You should see:
   - License usage (1 of 1 used, 0 available for free trial)
   - Your account listed as "Owner"
   - "Invite Team Member" button (disabled if no licenses available)
   - Role permissions section at bottom

**Try This:**
- Upgrade to Organization plan first (in Billing)
- Return to Members modal
- Click "Invite Team Member"
- Enter an email and select a role
- Send invitation
- See pending invitation appear in the list

#### Test Role Permissions

**As Owner:**
- Can access Billing ✓
- Can access Members ✓
- Can invite members ✓
- Can change roles ✓
- Can remove members ✓

**To Test Admin/Super Admin Roles:**
1. Upgrade to Organization plan
2. Invite a test user with Admin role
3. Log in as that user
4. Notice:
   - Price Book opens in view-only mode
   - Cannot access Billing
   - Cannot invite members

## Visual Testing Checklist

### Billing Modal
- [ ] Modal opens and closes smoothly
- [ ] Trial banner shows correct days remaining
- [ ] Plan cards display with correct pricing
- [ ] Monthly/Yearly toggle works
- [ ] Additional licenses counter works (org plan)
- [ ] Pricing calculations are correct
- [ ] Plan selection shows success message
- [ ] "View Only" banner appears for non-owners

### Members Modal
- [ ] Modal opens and closes smoothly
- [ ] License usage displays correctly
- [ ] Current members list shows with roles
- [ ] Role badges have correct icons and colors
- [ ] Invite form appears when clicking invite button
- [ ] Email validation works
- [ ] Role selection dropdown works
- [ ] Pending invitations section appears
- [ ] Remove member confirmation dialog works
- [ ] Role change dropdown works (owner only)

### Sidebar
- [ ] Account menu shows updated items
- [ ] "Members" and "Billing" items are clickable
- [ ] "SOON" tags are removed
- [ ] Chevron icons appear on menu items
- [ ] Menu closes when opening modals

## Test User Scenarios

### Scenario 1: Individual Professional
```
1. Sign up as a new user
2. Verify you start on Free Trial
3. Explore features during trial
4. Upgrade to Individual plan
5. Notice you still have 1 license
6. Cannot invite team members
```

### Scenario 2: Small Team (3 members)
```
1. Start as Free Trial user
2. Upgrade to Organization plan
3. See 3 licenses available (0 used, 3 available)
4. Invite 2 team members
   - One as Super Admin
   - One as Admin
5. Verify license usage updates (3 used, 0 available)
6. Log in as each member and test permissions
```

### Scenario 3: Growing Team (need more licenses)
```
1. Start with Organization plan (3 licenses)
2. All 3 licenses are used
3. Try to invite 4th member
4. See error: "No licenses available"
5. Go to Billing
6. Add 2 additional licenses
7. See pricing update (base + 2 × license fee)
8. Return to Members
9. See license usage: 3 of 5 used, 2 available
10. Successfully invite 4th member
```

### Scenario 4: Trial Expiration
```
1. New user starts Free Trial
2. See banner: "30 days remaining in trial"
3. Use app normally
4. Check banner daily to see countdown
5. At expiration, see "Trial expired" message
6. (Future: account restricted until upgrade)
```

## Troubleshooting

### Migration Fails
**Error**: "relation already exists"
- The migration checks for existing tables before creating
- If you see this, check if a partial migration ran
- Solution: Drop the tables and rerun, or modify migration to skip existing tables

### "No organization found" Error
- Check that user profile was created
- Run: `SELECT * FROM organization_memberships WHERE user_id = '<your-user-id>'`
- If missing, manually create organization and membership

### Members Modal Shows No Members
- Check RLS policies are enabled
- Verify user is authenticated: `SELECT auth.uid()`
- Check organization_memberships table has data

### Billing Modal Won't Open
- Check browser console for errors
- Verify `get_user_organization_membership` function exists
- Test function: `SELECT * FROM get_user_organization_membership('<user-id>')`

### Price Book Locked for Admin
- This is expected behavior! Admins have view-only access
- Solution: Change role to Super Admin or Owner

## Database Inspection

Useful queries for testing:

```sql
-- See all organizations
SELECT * FROM organizations;

-- See all memberships
SELECT 
  om.*,
  o.name as org_name,
  p.email
FROM organization_memberships om
JOIN organizations o ON om.organization_id = o.id
JOIN profiles p ON om.user_id = p.id;

-- See all subscriptions
SELECT 
  s.*,
  o.name as org_name
FROM subscriptions s
JOIN organizations o ON s.organization_id = o.id;

-- See pending invitations
SELECT 
  oi.*,
  o.name as org_name
FROM organization_invitations oi
JOIN organizations o ON oi.organization_id = o.id
WHERE status = 'pending';

-- Check license usage
SELECT 
  o.name as organization,
  s.total_licenses,
  COUNT(om.id) as used_licenses,
  s.total_licenses - COUNT(om.id) as available_licenses
FROM organizations o
JOIN subscriptions s ON o.id = s.organization_id
LEFT JOIN organization_memberships om ON o.id = om.organization_id
GROUP BY o.id, o.name, s.total_licenses;
```

## Next Steps

After testing the UI/DB structure:

1. **Set up Stripe account** and get API keys
2. **Install Stripe packages**: `npm install stripe @stripe/stripe-js`
3. **Create Stripe products** for each plan/cycle combination
4. **Implement checkout flow** in BillingModal
5. **Add webhook handlers** for subscription events
6. **Implement email invitations** using SendGrid, Resend, or similar
7. **Add trial expiration enforcement** to restrict access after 30 days

## Support Resources

- **Main Documentation**: `WORKSPACE_SETTINGS_IMPLEMENTATION.md`
- **Database Schema**: `supabase/migrations/20250123000000_add_workspace_settings.sql`
- **Type Definitions**: `types/database.ts`
- **Permission Helpers**: `lib/permissions.ts`
- **UI Components**: 
  - `components/BillingModal.tsx`
  - `components/MembersModal.tsx`
  - `components/NewSidebar.tsx`

## Feedback

As you test, note any:
- UI/UX issues or improvements
- Permission edge cases
- Pricing calculation errors
- Missing features or functionality
- Performance concerns

Good luck testing! 🚀

