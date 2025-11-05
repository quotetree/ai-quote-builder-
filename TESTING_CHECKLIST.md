# Chat Builder Testing Checklist

## Pre-Testing Setup

- [ ] OpenAI API key is configured in `.env.local`
- [ ] Supabase is connected and running
- [ ] Price book has at least 10-15 products
- [ ] Products have descriptions, tags, and prices set
- [ ] At least one product family is created
- [ ] Development server is running (`npm run dev`)

## Test Scenarios

### Scenario 1: First-Time User Experience

**Steps:**
1. [ ] Create a new project with a descriptive name
2. [ ] Select 1-2 product families
3. [ ] Click "Create Project"
4. [ ] Verify welcome message appears immediately
5. [ ] Check that AI asks for scope of work

**Expected Results:**
- Welcome message displays within 1 second
- AI introduces itself and asks for scope
- No errors in console

---

### Scenario 2: Basic Quote Generation Flow

**Steps:**
1. [ ] Enter a scope of work (e.g., "Install security cameras in a small office")
2. [ ] Wait for AI response
3. [ ] AI should ask 2-4 follow-up questions
4. [ ] Answer each question
5. [ ] AI should eventually ask permission to generate quote
6. [ ] Say "yes" or "generate quote"
7. [ ] Verify quote appears with proper formatting

**Expected Results:**
- AI asks intelligent, relevant questions
- Questions relate to products in price book
- Quote has blue gradient background
- Quote includes:
  - Line items table
  - Subtotal, tax, total
  - Profit margin
  - "Commit to Quote Log" button

**Visual Checks:**
- [ ] Quote message has "Quote Generated" badge with trending icon
- [ ] Table is formatted correctly
- [ ] Numbers are aligned and readable
- [ ] Commit button is blue and clickable

---

### Scenario 3: Natural Language Modifications

**Steps:**
1. [ ] After generating a quote, enter: "add 9% sales tax"
2. [ ] Verify AI updates the quote
3. [ ] Enter: "apply 10% discount to item 1"
4. [ ] Verify discount is applied
5. [ ] Enter: "remove item 3"
6. [ ] Verify item is removed
7. [ ] Enter: "change quantity of item 1 to 50"
8. [ ] Verify quantity updates

**Expected Results:**
- AI understands each command
- Quote is regenerated with changes
- Calculations are correct
- AI explains what changed

---

### Scenario 4: Commit Quote to Log

**Steps:**
1. [ ] Generate a quote (follow Scenario 2)
2. [ ] Click "Commit to Quote Log" button
3. [ ] Button should show "Committing..."
4. [ ] Wait for success toast
5. [ ] Verify button changes to "Committed to Quote Log" with checkmark
6. [ ] Navigate to Quote Log (if available)
7. [ ] Verify quote appears there

**Expected Results:**
- No errors during commit
- Success toast appears
- Quote has unique quote number (Q-0001, etc.)
- All line items are saved
- Quote can be accessed from log

---

### Scenario 5: Empty Price Book Handling

**Steps:**
1. [ ] Create a new user or clear price book
2. [ ] Create a project
3. [ ] Try to chat

**Expected Results:**
- AI responds with helpful message about empty price book
- Message includes instructions to add products
- No crash or error

---

### Scenario 6: Conversation Context Persistence

**Steps:**
1. [ ] Start a conversation
2. [ ] Send 3-4 messages
3. [ ] Navigate away from the project
4. [ ] Come back to the same project
5. [ ] Verify messages are still there
6. [ ] Continue conversation
7. [ ] Verify AI remembers context

**Expected Results:**
- All messages persist
- Conversation continues naturally
- No duplicate welcome messages
- AI maintains context

---

### Scenario 7: Recommendation Testing

**Steps:**
1. [ ] Enter vague scope: "Need some cameras"
2. [ ] AI should ask clarifying questions
3. [ ] Answer with some details but not all
4. [ ] AI should recommend specific products
5. [ ] AI should offer alternatives

**Expected Results:**
- AI message has amber background (recommendation)
- "AI Recommendation" badge with sparkle icon
- AI suggests 2-3 specific products from price book
- AI offers budget vs premium options

---

### Scenario 8: Long Conversation

**Steps:**
1. [ ] Start conversation
2. [ ] Exchange 10+ messages
3. [ ] Generate a quote
4. [ ] Verify conversation summary appears

**Expected Results:**
- Context summary box appears after 5+ messages
- Summary shows:
  - Scope provided status
  - Products discussed
  - Topics covered
  - Last quote details

---

### Scenario 9: Multiple Quote Revisions

**Steps:**
1. [ ] Generate initial quote
2. [ ] Make 3-4 modifications using different commands
3. [ ] Verify each revision is correct
4. [ ] Commit final quote
5. [ ] Verify committed quote has latest values

**Expected Results:**
- Each modification works correctly
- Totals recalculate properly
- Final quote reflects all changes
- No duplicate line items

---

### Scenario 10: Error Handling

**Steps:**
1. [ ] Try to commit quote twice (click button again)
2. [ ] Enter nonsensical modification: "xyzabc123"
3. [ ] Send very long message (1000+ words)
4. [ ] Disconnect internet, try to send message

**Expected Results:**
- Second commit shows already committed
- AI handles unclear commands gracefully
- Long messages are handled
- Error toast appears for network issues

---

## UI/UX Checks

### Message Formatting

- [ ] Bold text (**text**) renders correctly
- [ ] Bullet points display with blue dots
- [ ] Checkmarks (✓) display in green
- [ ] Tables are monospaced and aligned
- [ ] Line breaks are preserved
- [ ] No text overflow

### Visual Polish

- [ ] User messages are right-aligned, gray background
- [ ] AI messages are left-aligned, white background
- [ ] Quote messages have blue gradient
- [ ] Recommendation messages have amber gradient
- [ ] Icons render correctly (Sparkles, TrendingUp, Save)
- [ ] Loading animation is smooth
- [ ] Scroll behavior is smooth

### Responsive Design

- [ ] Works on desktop (1920x1080)
- [ ] Works on laptop (1366x768)
- [ ] Text is readable at all sizes
- [ ] Buttons are clickable
- [ ] No horizontal scrolling

---

## Performance Checks

- [ ] First message response < 3 seconds
- [ ] Subsequent messages < 2 seconds
- [ ] Quote generation < 5 seconds
- [ ] Quote commit < 2 seconds
- [ ] No memory leaks during long conversations
- [ ] Smooth scrolling with 50+ messages

---

## Database Verification

After testing, verify in Supabase:

- [ ] `chat_messages` table has all messages
- [ ] `quotes` table has committed quotes
- [ ] `quote_items` table has all line items
- [ ] Quote numbers are sequential
- [ ] All foreign keys are correct
- [ ] Timestamps are accurate

---

## Browser Testing

Test in multiple browsers:

- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (if on Mac)
- [ ] Edge (if on Windows)

---

## Known Limitations

Things that are expected behavior:

1. **Product Limit**: Only first 50 products in AI context
2. **Message History**: Only last 15 messages sent to AI
3. **Parse Accuracy**: Complex tables may not parse 100%
4. **Brand Detection**: Limited to common brands
5. **Token Limits**: Very long conversations may hit limits

---

## Success Criteria

The feature is working correctly if:

✅ All basic scenarios pass
✅ At least 8/10 scenarios pass completely
✅ No critical bugs (crashes, data loss)
✅ UI is polished and professional
✅ Performance is acceptable
✅ Quotes commit successfully
✅ Context persists across sessions

---

## Reporting Issues

If you find issues:

1. Note the scenario number
2. Capture console errors
3. Screenshot the issue
4. Note the exact steps to reproduce
5. Check browser console for errors
6. Review Supabase logs if needed

---

## Next Steps After Testing

Once testing passes:

1. [ ] Gather user feedback
2. [ ] Monitor API usage and costs
3. [ ] Track conversation metrics
4. [ ] Identify common user patterns
5. [ ] Plan improvements based on usage
6. [ ] Document edge cases
7. [ ] Create user training materials

---

**Happy Testing! 🚀**



