# Project Sorting by Recent Activity

## Problem

Projects in the left sidebar were displayed in a fixed chronological order based on creation date. When users made changes inside a project (editing quotes, sending chat messages, adding notes, etc.), the project would not move to the top of the list. This made it difficult to find recently active projects.

## Solution

Implemented automatic project timestamp updates so that any activity within a project updates its `updated_at` timestamp, causing it to appear at the top of the sidebar.

### Implementation Details

#### 1. Utility Function
Created `lib/updateProjectTimestamp.ts` with two functions:
- `updateProjectTimestamp(projectId)` - Client-side version for use in hooks/components
- `updateProjectTimestampServer(supabase, projectId)` - Server-side version for use in API routes

Both functions update the project's `updated_at` field to the current timestamp.

#### 2. Integration Points

The timestamp update is now triggered automatically when:

**Chat Activity**
- User sends a message (`app/api/chat/route.ts`)

**Quote Activity** (`hooks/useQuotes.ts`)
- Quote is created
- Quote status is changed
- Quote is renamed
- Quote is duplicated

**Edit Activity** (`lib/editSessionController.ts`)
- Edit session is started on a quote

#### 3. Existing Sorting

The sidebar already had sorting by `updated_at DESC` in place (`hooks/useProjects.ts` line 31), so no changes to the sorting logic were needed. The fix was purely adding timestamp updates at activity points.

## Files Modified

1. **lib/updateProjectTimestamp.ts** (NEW)
   - Utility functions for updating project timestamps

2. **app/api/chat/route.ts**
   - Added import and call to `updateProjectTimestampServer`
   - Updates timestamp after processing chat message

3. **hooks/useQuotes.ts**
   - Added import and calls to `updateProjectTimestamp`
   - Updates timestamp in: `createQuote`, `updateQuoteStatus`, `updateQuote`, `duplicateQuote`

4. **lib/editSessionController.ts**
   - Added import and call to `updateProjectTimestamp`
   - Updates timestamp in `startEditSession`

## User Experience

### Before
- Projects stayed in chronological creation order
- Recently worked-on projects could be buried in the list
- Users had to scroll to find active projects

### After
- Most recently updated project always appears at the top
- Any activity (chat, quote edit, etc.) moves project to top
- Messaging app-like behavior - active conversations float to top
- Internal chat order within projects remains unchanged

## Technical Notes

- The `updated_at` field already exists in the `projects` table
- Updates are non-blocking and don't throw errors if they fail
- Timestamp updates are logged for debugging: `✅ Updated project timestamp for {projectId}`
- The operation is async but doesn't block the main action (e.g., message sending still works if timestamp update fails)

## Testing

To verify the fix works:

1. **Open a project** - It should move to the top of the sidebar
2. **Send a chat message** - Project stays/moves to top
3. **Create a quote** - Project moves to top
4. **Edit a quote** - Project moves to top
5. **Rename a quote** - Project moves to top
6. **Change quote status** - Project moves to top
7. **Switch between projects** - Most recently used should always be at top

## Future Enhancements

Additional activities that could trigger timestamp updates:
- Uploading documents to Drive
- Creating/editing notes
- Changing project settings
- Adding team members (when that feature is available)

