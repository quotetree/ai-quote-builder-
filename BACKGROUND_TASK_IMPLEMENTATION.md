# Background Task Execution Feature

## Overview
Chat operations now continue running in the background even when you navigate away from a project. This means you can start a prompt, switch to a different project, and return later to find the AI response and product suggestions ready.

## What Changed

### 1. **Removed Request Abortion** (`components/SplitChatPanel.tsx`)
- Removed `AbortController` that was canceling requests when navigating away
- Chat API fetch requests now continue even after component unmount
- Modified `stopGeneration()` to only remove the message (can't abort background tasks)

### 2. **Added Message Polling** (`components/SplitChatPanel.tsx`)
- Polls for new messages every 2 seconds when viewing a project
- Automatically detects when background tasks complete
- Turns off loading indicator when new assistant messages arrive
- Reloads working state to display products from background tasks

### 3. **Background Task Detection** (`components/SplitChatPanel.tsx`)
- When returning to a project, checks if last message is from user
- If yes, shows loading indicator (task still running)
- Polling will detect completion and update UI automatically

### 4. **Persistent Product Storage** (`app/api/chat/route.ts`)
- API now saves suggested products to `project_working_state` table
- Products persist even if client navigates away before response completes
- When user returns, working state is loaded with the background-generated products

## How It Works

### Scenario 1: Navigate Away While Loading
1. User sends message: "I need 5 Verkada cameras"
2. Chat shows loading indicator
3. User navigates to different project (Project B)
4. **Background**: API continues searching products, generates response
5. **Background**: API saves assistant message to `chat_messages` table
6. **Background**: API saves suggested products to `project_working_state` table
7. User returns to original project (Project A)
8. Component detects unanswered user message → shows loading indicator
9. Polling detects new assistant message → turns off loading, displays response
10. Working state loads → suggested products appear in right panel

### Scenario 2: Multiple Projects Running Simultaneously
1. User starts task in Project A, navigates away
2. User starts task in Project B, navigates away
3. Both API calls continue in background
4. Both complete and save to database independently
5. User can return to either project and see completed results

## Technical Details

### Polling Mechanism
```typescript
// Polls every 2 seconds for new messages
const pollForNewMessages = async () => {
  // Get messages newer than our last message
  const { data: newMessages } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("project_id", projectId)
    .gt("created_at", lastMessage.created_at);
  
  if (newMessages.length > 0) {
    // Add to UI and reload working state
    setMessages(prev => [...prev, ...newMessages]);
    await loadWorkingState();
  }
};
```

### Background Persistence
```typescript
// API saves products to database for background tasks
if (productSuggestions.length > 0) {
  await supabase
    .from("project_working_state")
    .upsert({
      project_id: projectId,
      suggested_products: productsWithIds,
      show_split_view: true
    });
}
```

## Testing Instructions

### Test 1: Basic Background Execution
1. Go to a project
2. Send a message: "I need 10 cameras and 5 access control licenses"
3. **Immediately** navigate to a different project (within 1-2 seconds)
4. Wait 10-15 seconds
5. Navigate back to original project
6. **Expected**: You should see the AI response and suggested products

### Test 2: Multiple Concurrent Tasks
1. Open Project A, send: "I need cameras"
2. Navigate away immediately
3. Open Project B, send: "I need access control"
4. Navigate away immediately
5. Wait 20 seconds
6. Return to Project A → **Expected**: See cameras suggested
7. Return to Project B → **Expected**: See access control suggested

### Test 3: Loading State Persistence
1. Send a message and navigate away while loading
2. Return to project before task completes
3. **Expected**: Loading indicator should appear
4. Wait for completion
5. **Expected**: Loading turns off, response appears automatically

### Test 4: Product Retrieval Specifically
1. Send: "I need Verkada 5-year intercom license"
2. Navigate away immediately (don't wait for response)
3. Go to Dashboard or another project
4. Wait 10 seconds
5. Return to original project
6. **Expected**: 
   - Chat shows AI response
   - Right panel shows "Suggested Products" tab with the license
   - Product is ready to apply to quote

## What Stays the Same

- ✅ No new visual indicators (loading state works as before)
- ✅ UI/UX unchanged - same chat experience
- ✅ Stop button still works (removes user message, can re-edit)
- ✅ Clear chat, submit quote, all other features unchanged

## Performance Considerations

- Polling runs every 2 seconds (minimal database load)
- Polling only active when viewing a project
- Polling stops when navigating away
- API requests timeout after standard Next.js duration (~30 seconds)

## Limitations

- Tasks that take longer than Next.js timeout (~30s) may fail
- No visual indicator on other projects that tasks are running (by design)
- Stop button can't abort background tasks (only removes the message)

## Database Tables Used

1. **`chat_messages`**: Stores all chat messages (user and assistant)
2. **`project_working_state`**: Stores suggested products and quote preview
   - Updated by API when products are found
   - Loaded by component when returning to project

## No Migration Required

This feature uses existing database tables. No schema changes needed.

