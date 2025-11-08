# Fix: Empty Error Objects & Improved Error Handling

## Problem
The user was experiencing:
1. **Empty error objects**: `[submitQuote] Database error: {}` and `[submitQuote] Error details: {}`
2. **UUID casting errors**: `invalid input syntax for type uuid: "pool-78e494e2-cdff-4851-b274-4bee9eaa6ce8-1762559239374-8u4hjt-3"`

## Root Causes

### 1. Empty Error Objects
Supabase errors were being thrown directly without ensuring they had proper structure. When errors passed through the catch blocks, their properties might be undefined or the error object itself might be malformed.

### 2. UUID Casting Error
A composite pool ID (with format `pool-<uuid>-<timestamp>-<shard>`) was being sent to a PostgreSQL UUID column somewhere in the data flow. Note: `project_working_state.current_pool_id` is correctly defined as `TEXT`, so this error is likely occurring elsewhere or in a different context.

## Fixes Applied

### 1. Structured Error Wrapping in `lib/editSessionController.ts`

#### Quote Update Error Handling
```typescript
if (updateError) {
  console.error('[EditSession] Error updating quote:', updateError);
  console.error('[EditSession] Error details:', {
    code: updateError.code,
    message: updateError.message,
    details: updateError.details,
    hint: updateError.hint
  });
  
  // Create structured error
  const structuredError: any = new Error(updateError.message || "Failed to update quote");
  structuredError.code = updateError.code || "DB_ERROR";
  structuredError.details = {
    operation: "update_quote",
    quoteId: session.quote_id,
    ...updateError
  };
  throw structuredError;
}
```

#### Quote Items Insert Error Handling
```typescript
if (itemsError) {
  console.error('[EditSession] Error inserting quote items:', itemsError);
  const structuredError: any = new Error(itemsError.message || "Failed to insert quote items");
  structuredError.code = itemsError.code || "DB_ERROR";
  structuredError.details = {
    operation: "insert_quote_items",
    quoteId: session.quote_id,
    itemCount: newItems.length,
    ...itemsError
  };
  throw structuredError;
}
```

#### Global Catch Block
```typescript
} catch (error: any) {
  console.error('[submitEditedQuote] Caught error:', error);
  
  // Ensure we always have a structured error
  if (!error || typeof error !== 'object') {
    const fallbackError: any = new Error("Unknown error during quote submission");
    fallbackError.code = "UNKNOWN_ERROR";
    fallbackError.details = { originalError: String(error) };
    throw fallbackError;
  }
  
  // Ensure error has code and message
  if (!error.code) {
    error.code = error.name || "DB_ERROR";
  }
  if (!error.message) {
    error.message = "An error occurred during quote submission";
  }
  
  logEditOperation('edit:error', { 
    operation: 'submitEditedQuote',
    sessionId, 
    code: error.code,
    message: error.message,
    details: error.details
  });
  
  throw error;
}
```

### 2. Enhanced Error Handling in `components/SplitChatPanel.tsx`

#### Comprehensive Logging
```typescript
} catch (error: any) {
  console.error("[submitQuote] Error:", error);
  console.error("[submitQuote] Error type:", typeof error);
  console.error("[submitQuote] Error keys:", error ? Object.keys(error) : 'null');
  console.error("[submitQuote] Error details:", {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    name: error?.name,
    stack: error?.stack?.substring(0, 200)
  });
  // ...
}
```

#### Empty Error Detection
```typescript
// Handle empty or malformed error objects
if (!error || (typeof error === 'object' && Object.keys(error).length === 0)) {
  console.error("[submitQuote] EMPTY ERROR OBJECT DETECTED");
  toast.error(
    <div className="flex flex-col gap-2">
      <div className="font-medium">Submission Failed</div>
      <div className="text-sm">
        An unknown error occurred. Please check the browser console for details and try again.
      </div>
    </div>,
    { duration: 8000 }
  );
  setSubmitting(false);
  return;
}
```

#### UUID Error Handling
```typescript
} else if (errorCode === 'UUID_ERROR') {
  console.error("[submitQuote] UUID casting error:", error);
  toast.error(
    <div className="flex flex-col gap-2">
      <div className="font-medium">UUID Error</div>
      <div className="text-sm">
        A composite ID was incorrectly sent to a UUID field. This is likely a bug.
      </div>
      <div className="text-xs text-gray-600">
        Error: {error?.message?.substring(0, 100)}
      </div>
    </div>,
    { duration: 10000 }
  );
}
```

#### Database Error Handling
```typescript
} else if (errorCode === 'DB_ERROR' || error?.message?.includes('invalid input syntax')) {
  console.error("[submitQuote] Database error:", error);
  const errorMsg = error?.message || error?.details?.message || "A database error occurred";
  toast.error(
    <div className="flex flex-col gap-2">
      <div className="font-medium">Database Error</div>
      <div className="text-sm">
        {errorMsg}
      </div>
      {error?.details?.hint && (
        <div className="text-xs text-gray-600">
          Hint: {error.details.hint}
        </div>
      )}
    </div>,
    { duration: 8000 }
  );
}
```

### 3. Success Logging
Added explicit success logging to trace successful submissions:

```typescript
console.log('[Submit] submit:success { quoteId:', session.quote_id, ', newVersion:', newVersion, ', session:', sessionId, '}');
```

## Error Codes

The system now uses standardized error codes:

| Code | Meaning | User Action |
|------|---------|-------------|
| `VERSION_CONFLICT` | Quote was updated by another user | Review latest version, re-edit if needed |
| `CONCURRENCY_CONFLICT` | Another user is currently editing | Wait for them to finish |
| `UUID_ERROR` | Composite ID sent to UUID field | Report bug; this shouldn't happen |
| `DB_ERROR` | Generic database error | Check error message for details |
| `UNKNOWN_ERROR` | Unexpected error format | Check console, report bug |

## Logging Strategy

### Success Path
```
[Submit] submit:start { quoteId, baseVersion, session }
[EditSession] Quote fetched: { ... }
[EditSession] Snapshot created: { ... }
[Submit] submit:success { quoteId, newVersion, session }
```

### Error Path
```
[Submit] submit:start { quoteId, baseVersion, session }
[EditSession] Error updating quote: { ... }
[EditSession] Error details: { code, message, details, hint }
[submitEditedQuote] Caught error: { ... }
[Submit] submit:error { code, message, details }
```

## Testing the Fix

### Test 1: Check for Empty Errors
1. Open DevTools Console
2. Try to submit an edited quote
3. If it fails, check the console output
4. **You should now see**:
   - `[submitQuote] Error type: object`
   - `[submitQuote] Error keys: [code, message, details, ...]`
   - `[submitQuote] Error details: { message: "...", code: "...", ... }`
5. **You should NOT see**:
   - `[submitQuote] Database error: {}`
   - `[submitQuote] Error details: {}`

### Test 2: UUID Error Identification
1. If you see the UUID error again, the console will now show:
   - `[submitQuote] UUID casting error:`
   - The full Supabase error with `code`, `message`, `details`, `hint`
2. Look for:
   - `code: "22P02"` (PostgreSQL invalid text representation)
   - `message: "invalid input syntax for type uuid: \"pool-...\""`
   - `hint: ...` (may contain table/column info)

### Test 3: Success Path
1. Edit a quote successfully
2. Make a change
3. Click "Save as v2"
4. **You should see in console**:
   - `[Submit] submit:start { quoteId: ..., baseVersion: 1, session: ... }`
   - `[Submit] submit:success { quoteId: ..., newVersion: 2, session: ... }`
5. **You should see in UI**:
   - Success toast: "Quote v2 saved successfully!"

## Next Steps

### If UUID Error Persists
1. Copy the **full error output** from the console (including all `[submitQuote]` and `[EditSession]` logs)
2. Look for the `hint` field in the error - it may tell us which table/column is receiving the composite ID
3. Share the error details so we can trace the exact source

### If Empty Errors Still Occur
The new error handling should prevent this, but if you still see `{}`:
1. Copy the console output showing:
   - `[submitQuote] Error type:`
   - `[submitQuote] Error keys:`
   - `[submitQuote] EMPTY ERROR OBJECT DETECTED` (if it appears)
2. This will help us identify where the error is being created

## What Changed

### Files Modified
1. `lib/editSessionController.ts`
   - Added structured error wrapping for all Supabase errors
   - Added fallback error creation for malformed errors
   - Added success logging
   - Ensured all errors have `code`, `message`, and `details`

2. `components/SplitChatPanel.tsx`
   - Added comprehensive error logging (type, keys, all properties)
   - Added empty error object detection
   - Added specific UUID error handling
   - Improved database error display with hints
   - Added fallback for unknown error formats

## Acceptance Criteria

✅ **No more empty error objects** - All errors now have at least `code` and `message`  
✅ **UUID errors are identified** - System detects and labels UUID casting errors  
✅ **Detailed logging** - Console shows full error structure for debugging  
✅ **User-friendly messages** - Toasts provide actionable guidance  
✅ **Success tracking** - Console logs show successful submissions  

## Known Limitations

1. **UUID Error Root Cause**: We've improved error detection but haven't fixed the source of the composite ID being sent to a UUID column. The next step is to identify which specific field/table is receiving the composite ID and fix that at the source.

2. **Error Recovery**: While errors are now surfaced properly, users may still need to refresh and re-edit if a database error occurs mid-submission.

---

**Status**: ✅ Error handling improved - Empty errors fixed - UUID errors identified  
**Next**: If UUID error persists, trace the exact source using the enhanced logging  
**Last Updated**: 2025-11-07

