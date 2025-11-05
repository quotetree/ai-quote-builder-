# Troubleshooting Guide - Chat Builder

## "Failed to get AI response" Error

This error occurs when the chat cannot connect to OpenAI. Here are the steps to fix it:

### Step 1: Verify OpenAI API Key

1. **Check your `.env.local` file exists** in the project root
2. **Verify the API key format**:
   ```env
   OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxx
   ```
   - Should start with `sk-proj-` or `sk-`
   - Should be a long alphanumeric string
   - No spaces or quotes around it

3. **Test your API key** is valid:
   ```bash
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer YOUR_API_KEY_HERE"
   ```
   If you get an error, your key is invalid.

### Step 2: Restart Development Server

Environment variables are only loaded when the server starts. After changing `.env.local`:

```bash
# Stop the dev server (Ctrl+C)
# Then restart it:
npm run dev
```

### Step 3: Check Browser Console

1. Open browser DevTools (F12 or Cmd+Option+I)
2. Go to **Console** tab
3. Try sending a message again
4. Look for red error messages
5. Screenshot or copy the error text

### Step 4: Check Server Terminal

Look at your terminal where `npm run dev` is running:
- Red error messages?
- OpenAI API errors?
- Network errors?

### Common Issues & Fixes

#### Issue: "API key is invalid"
**Fix**: Get a new API key from https://platform.openai.com/api-keys
```env
OPENAI_API_KEY=sk-proj-YOUR_NEW_KEY_HERE
```

#### Issue: "Rate limit exceeded"
**Fix**: Wait a few minutes or upgrade your OpenAI plan

#### Issue: "Network error"
**Fix**: 
- Check internet connection
- Try disabling VPN
- Check firewall settings

#### Issue: Server not picking up environment variables
**Fix**:
1. Stop dev server completely
2. Close terminal
3. Open new terminal
4. `cd` to project directory
5. Run `npm run dev` again

#### Issue: API key has no credits
**Fix**: Add billing to your OpenAI account at https://platform.openai.com/account/billing

### Step 5: Check OpenAI Account Status

1. Go to https://platform.openai.com/account/usage
2. Check you have:
   - ✅ Active API key
   - ✅ Billing set up (credit card added)
   - ✅ Available credits or spending limit

### Step 6: Verify Environment Variables Load

Add this temporary debug line to `app/api/chat/route.ts` after line 5:

```typescript
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// TEMPORARY DEBUG - Remove after testing
console.log("OpenAI API Key exists:", !!process.env.OPENAI_API_KEY);
console.log("API Key starts with:", process.env.OPENAI_API_KEY?.substring(0, 7));
```

Check your terminal - you should see:
```
OpenAI API Key exists: true
API Key starts with: sk-proj
```

If you see `false` or `undefined`, the environment variable isn't loading.

### Step 7: Test API Route Directly

Test the API endpoint directly with curl:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "YOUR_PROJECT_ID",
    "message": "Hello",
    "history": []
  }'
```

Replace `YOUR_PROJECT_ID` with an actual project ID from your database.

### Step 8: Check Price Book

The chat needs products in your price book to work:

1. Click **"Price Book"** in sidebar
2. Verify you have at least a few products added
3. If empty, add some test products first

### Step 9: Fresh Install (Last Resort)

If nothing works:

```bash
# Backup your .env.local
cp .env.local .env.local.backup

# Clean install
rm -rf node_modules .next
npm install
npm run dev
```

---

## Other Common Issues

### Chat Messages Not Showing

**Symptoms**: Send message, nothing appears

**Fixes**:
1. Check browser console for errors
2. Verify Supabase connection
3. Check `chat_messages` table exists in Supabase
4. Verify authentication is working

### Welcome Message Not Appearing

**Symptoms**: Blank chat screen

**Fix**: The welcome message loads from database. Check:
1. Supabase is connected
2. `chat_messages` table has RLS policies
3. You're authenticated

### Commit Quote Button Not Working

**Symptoms**: Click "Commit to Quote Log" - nothing happens

**Fixes**:
1. Check browser console for errors
2. Verify `quotes` and `quote_items` tables exist
3. Check RLS policies allow inserts
4. Verify quote parsing is working

### Quotes Not Parsing

**Symptoms**: Quote generates but can't commit

**Fix**: The quote format must be exact. Check:
1. Quote includes "QUOTE GENERATED"
2. Has table with line items
3. Has Subtotal, Tax, Total lines
4. Check console for parsing errors

---

## Getting Help

If you're still stuck:

1. **Check the error message** - it now shows the real error
2. **Look at console logs** - browser and server
3. **Verify all environment variables** are set
4. **Test OpenAI API key** with curl
5. **Restart the dev server** after any .env.local changes

---

## Quick Checklist

Before reporting an issue:

- [ ] `.env.local` file exists with `OPENAI_API_KEY`
- [ ] OpenAI API key is valid and starts with `sk-`
- [ ] OpenAI account has billing set up
- [ ] Dev server was restarted after adding/changing API key
- [ ] Browser console checked for errors
- [ ] Server terminal checked for errors
- [ ] Price book has products added
- [ ] Supabase is connected and working
- [ ] User is authenticated

---

**Updated Error Handling**: The chat now shows specific error messages instead of generic "Failed to get AI response". You should see the actual problem now!



