# Edit Quote - Quick Start Guide

## 🚀 Getting Started

### 1. Apply Database Migration

First, apply the database migration to add the necessary tables and columns:

```bash
# Option 1: Via Supabase CLI
supabase db push supabase/migrations/20241107_add_quote_edit_sessions.sql

# Option 2: Via Supabase Dashboard SQL Editor
# - Go to https://supabase.com/dashboard/project/YOUR_PROJECT/sql
# - Copy and paste the contents of supabase/migrations/20241107_add_quote_edit_sessions.sql
# - Click "Run"
```

### 2. Restart Your Dev Server

The server should already be running on **http://localhost:3008**. If not:

```bash
npm run dev
```

### 3. Test the Edit Quote Feature

1. **Open your app** at http://localhost:3008
2. **Sign in** to your account
3. **Navigate to a project** that has existing quotes
4. **Go to the Log tab** (Quote Log)
5. **Click the Edit button** (pencil icon) on any quote
6. **Observe:**
   - Chat tab opens automatically
   - Yellow banner appears showing "Editing: [Quote Name] (v1 → v2)"
   - Quote preview loads on the right with all items
7. **Make a change** via chat, for example:
   - "Add 5 more cameras"
   - "Change labor cost to $3,000"
   - "Remove the installation fee"
8. **Submit the edited quote:**
   - Click "Submit Quote" button
   - Enter optional change notes when prompted
   - New version (v2) is created
   - Original version (v1) remains unchanged

## 🧪 Testing All Features

### Test 1: Basic Edit
```
1. Click Edit on a quote
2. Say: "Add 2 more items"
3. Click Submit Quote
4. Verify: New version created, old version unchanged
```

### Test 2: Modify Quantity
```
1. Click Edit on a quote with items
2. Say: "Change quantity of [item name] to 10"
3. Verify: Preview updates with new quantity
4. Click Submit Quote
```

### Test 3: Remove Items
```
1. Click Edit
2. Say: "Remove [item name]"
3. Verify: Item removed from preview
4. Click Submit Quote
```

### Test 4: Add Tax/Charges
```
1. Click Edit
2. Say: "Add 9% sales tax"
3. Verify: Tax appears in preview
4. Click Submit Quote
```

### Test 5: Cancel Editing
```
1. Click Edit
2. Make some changes
3. Click "Cancel Edit" button
4. Confirm cancellation
5. Verify: Quote returns to normal state
```

### Test 6: Session Isolation
```
1. Open Project A, click Edit on Quote 1
2. Open Project B in another tab
3. Click Edit on Quote 2
4. Verify: Each project shows correct quote
5. Verify: No cross-contamination of items
```

### Test 7: Concurrency Control
```
1. User A: Click Edit on Quote #1
2. User B: Try to click Edit on same Quote #1
3. Verify: User B sees error or disabled button
4. User A: Submit quote
5. User B: Can now edit
```

## 📋 Expected Behavior

### Edit Mode Banner
When editing, you should see a yellow banner at the top showing:
- Quote name being edited
- Version transition (v2 → v3)
- Session ID
- "Cancel Edit" button

### Quote Preview
The preview panel should show:
- All line items from the original quote
- Correct quantities and prices
- Tax and charges (if any)
- Accurate totals

### Chat Interaction
In edit mode, the AI:
- Knows you're editing an existing quote
- Shows current quote contents in context
- Understands add/remove/modify commands
- Works statelessly (doesn't use chat history)

### Version History
After submitting:
- New version number appears in Quote Log
- Old version still visible
- Diff summary shows what changed
- Change notes (if provided) are saved

## 🐛 Common Issues

### Issue: Edit button doesn't work
**Fix:** 
- Check browser console for errors
- Verify migration was applied: `SELECT * FROM quote_edit_sessions;`
- Check if quote has stuck edit flag: `SELECT is_editing, edit_session_id FROM quotes;`

### Issue: Quote not loading in preview
**Fix:**
- Check working state: `SELECT * FROM project_working_state WHERE project_id = '...';`
- Check edit_mode is true
- Refresh the page

### Issue: "Concurrency conflict" error
**Fix:**
- Another user may be editing
- Check: `SELECT * FROM quote_edit_sessions WHERE status = 'active';`
- If stuck, manually clear: `UPDATE quotes SET is_editing = false WHERE id = '...';`

### Issue: Version not incrementing
**Fix:**
- Check quote version: `SELECT version_number FROM quotes WHERE id = '...';`
- Verify trigger exists: `\d quotes` in psql
- Check version_history: `SELECT * FROM quote_version_history;`

## 🎯 Acceptance Tests Checklist

Use this checklist to verify all features work:

- [ ] AT1: Clicking Edit loads exact quote in preview
- [ ] AT2: Simple edits ("increase labor to $X") work correctly
- [ ] AT3: Swapping items removes old and adds new
- [ ] AT4: Submitting creates new version, preserves old
- [ ] AT5: Editing different quotes doesn't mix items
- [ ] AT6: Concurrent editing blocked with clear message
- [ ] AT7: Refreshing during edit resumes or prompts

## 📊 Database Queries for Testing

### View all edit sessions
```sql
SELECT 
  id, 
  quote_id, 
  version_being_edited, 
  status, 
  started_at 
FROM quote_edit_sessions 
ORDER BY started_at DESC;
```

### View quote versions
```sql
SELECT 
  quote_number, 
  version_number, 
  status, 
  is_editing,
  created_at 
FROM quotes 
WHERE quote_number = 'Q-0001'
ORDER BY version_number;
```

### View version history
```sql
SELECT 
  version_number, 
  change_type, 
  change_notes,
  diff_summary,
  created_at 
FROM quote_version_history 
WHERE quote_id = '...'
ORDER BY version_number DESC;
```

### Check for stuck edit locks
```sql
SELECT 
  id, 
  quote_name, 
  is_editing, 
  edit_session_id 
FROM quotes 
WHERE is_editing = true;
```

### Clean up stale sessions
```sql
SELECT cleanup_stale_edit_sessions();
```

## ✅ Success Criteria

You'll know the feature is working correctly when:

1. ✅ Edit button opens quote in chat with preview
2. ✅ Yellow banner shows edit mode information
3. ✅ Preview displays all items accurately
4. ✅ Chat understands edit commands
5. ✅ Changes update preview in real-time
6. ✅ Submit creates new version
7. ✅ Old version remains accessible
8. ✅ Version number increments
9. ✅ Diff summary shows changes
10. ✅ Cancel button exits edit mode cleanly

## 🎉 You're Ready!

The Edit Quote feature is fully implemented and ready to use. Enjoy editing your quotes with full version control and audit tracking!

For detailed technical documentation, see `EDIT_QUOTE_IMPLEMENTATION.md`.

