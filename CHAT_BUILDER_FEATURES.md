# Agentic AI Chat Builder - Feature Documentation

## Overview

The Quote Tree AI chat builder is an intelligent, conversational quote generation system that acts like an expert estimator sitting next to you. Instead of static forms, it uses dynamic, two-way conversation to extract complete project requirements and build accurate quotes in real-time.

## Core Features

### 1. **Agentic Intelligence System** ✨

The AI doesn't just ask static questions - it dynamically generates personalized follow-up questions based on your responses.

**How it works:**
- Analyzes your initial scope description
- Identifies what information is missing or unclear
- Asks 2-4 targeted follow-up questions
- Probes deeper until it has enough detail
- Uses your price book context to inform questions

**Example Flow:**
```
You: "Need to install security cameras for a 5000 sq ft warehouse"

AI: "Thanks! Let me ask a few clarifying questions:
     1. How many cameras are you thinking? Indoor, outdoor, or both?
     2. Do you need night vision or just daytime coverage?
     3. I see we have both Hikvision and Axis cameras in stock. Any brand preference?
     4. What about storage - how many days of footage should we keep?"
```

### 2. **Rich Product Context Intelligence** 📚

The AI understands your entire price book with deep context:
- Product names, brands, types
- Descriptions and specifications
- Product tags for better categorization
- Pricing (list, sales, cost)
- Profit margins
- Product families

**Benefits:**
- Makes intelligent product recommendations
- Suggests alternatives (budget vs premium)
- Understands which products fit the scope
- Shows margin information in quotes

### 3. **Natural Language Command Processing** 💬

Modify quotes using plain English commands:

```
"Add 9% sales tax"
"Apply 10% discount to all labor items"
"Remove item 3"
"Change quantity of item 2 to 50"
"Add 5% discount to items A, B, and C"
```

The AI parses these commands and updates the quote accordingly.

### 4. **Structured Quote Generation** 📊

When ready, the AI generates formatted quotes with:
- Line items table (product, description, qty, price, total)
- Subtotal, tax, discounts
- Total price
- Cost basis
- Projected profit margin

**Example Quote:**
```
---
QUOTE GENERATED

Project: Downtown Warehouse Security
Generated: November 4, 2025

Line Items:
| Item                    | Description              | Qty | Unit Price | Line Total |
|-------------------------|--------------------------|-----|-----------|-----------|
| Hikvision 4MP Camera    | Outdoor IP Camera        | 12  | $245.00   | $2,940.00 |
| Cat6 Cable 1000ft       | Network cable blue       | 2   | $185.00   | $370.00   |
| 16-Port PoE Switch      | Managed switch 250W      | 1   | $425.00   | $425.00   |
| Installation Labor      | Professional install     | 16  | $85.00    | $1,360.00 |

Subtotal: $5,095.00
Tax (9%): $458.55
Total: $5,553.55

Cost Basis: $3,240.00
Projected Profit: $1,855.00 (57.3% margin)
---
```

### 5. **Enhanced UI with Visual Indicators** 🎨

Messages are visually distinguished:

- **Regular AI Messages**: White background with border
- **Recommendations**: Amber gradient background with sparkle icon
- **Generated Quotes**: Blue gradient background with trending icon
- **User Messages**: Gray background, right-aligned

**Quote Messages Include:**
- "Quote Generated" badge
- Formatted content with tables
- "Commit to Quote Log" button
- Success indicator when committed

### 6. **Quote Commit System** 💾

When a quote is generated, you can commit it to your Quote Log:

**What happens:**
1. Quote is parsed from AI response
2. Saved to database with unique quote number
3. All line items are stored
4. Quote appears in Quote Log
5. Can be downloaded as PDF later

**Button States:**
- "Commit to Quote Log" (blue button)
- "Committing..." (loading state)
- "Committed to Quote Log" (green checkmark)

### 7. **Conversation Context & Memory** 🧠

The system tracks conversation state across sessions:

**Context Tracking:**
- Has scope been provided?
- Which products were mentioned?
- What topics were discussed?
- User preferences (brands, quality level)
- Last quote generated
- Pending questions

**Conversation Summary:**
Shows when conversations get longer:
```
✓ Scope of work has been provided
Products discussed: Security Camera, Cat6 Cable, PoE Switch
Topics covered: installation, budget
Preferred brands: Hikvision
Last quote generated: $5,553.55 at 2:45 PM
```

### 8. **Smart Follow-up Generation** 🎯

The AI uses conversation phases:

**Phase 1: Scope Discovery**
- Welcomes user warmly
- Asks for scope of work

**Phase 2: Deep-Dive Questions**
- Identifies gaps in information
- Asks targeted questions
- Uses price book to inform questions

**Phase 3: Product Recommendations**
- Suggests specific products
- Offers alternatives
- Explains reasoning

**Phase 4: Quote Confirmation**
- Summarizes understanding
- Asks permission to generate

**Phase 5: Quote Generation**
- Creates detailed quote
- Shows all calculations

**Phase 6: Refinement**
- Accepts modification commands
- Updates quote
- Shows changes

## Technical Implementation

### Files Created/Modified

1. **`app/api/chat/route.ts`** - Enhanced AI chat API
   - Sophisticated system prompt
   - Product context building
   - Conversation analysis
   - Dynamic token allocation

2. **`components/ChatPanel.tsx`** - Enhanced chat UI
   - Message formatting
   - Quote detection
   - Commit functionality
   - Visual indicators

3. **`lib/quoteParser.ts`** - Quote extraction utilities
   - Parse quotes from text
   - Extract line items
   - Parse modification commands
   - Format summaries

4. **`lib/conversationContext.ts`** - Context tracking
   - Build conversation context
   - Generate summaries
   - Suggest next actions
   - Track metrics

### Key Technologies

- **OpenAI GPT-4o**: Powers the agentic AI
- **Supabase**: Database and real-time sync
- **Next.js**: React framework
- **TypeScript**: Type safety
- **Tailwind CSS**: Styling

## How to Use

### For Users

1. **Create a Project**
   - Go to dashboard
   - Click "New Project"
   - Enter project name
   - Select product families

2. **Start Chatting**
   - AI welcomes you
   - Provide scope of work
   - Answer follow-up questions
   - Review recommendations

3. **Generate Quote**
   - AI asks permission
   - Quote appears formatted
   - Review line items
   - Check totals and margins

4. **Modify if Needed**
   - Use natural language
   - "Add 9% tax"
   - "Apply 10% discount"
   - AI updates quote

5. **Commit to Log**
   - Click "Commit to Quote Log"
   - Quote saved to database
   - Can download PDF later

### For Developers

**Testing the Chat Builder:**

```bash
# 1. Ensure OpenAI API key is set
export OPENAI_API_KEY="your-key-here"

# 2. Start development server
npm run dev

# 3. Navigate to a project
# Click on any project or create new one

# 4. Test conversation flow
# - Enter scope of work
# - Respond to questions
# - Request quote generation
# - Test modifications
# - Commit quote
```

**Test Scenarios:**

1. **Basic Quote Flow**
   - Enter simple scope
   - Answer 2-3 questions
   - Generate quote
   - Commit to log

2. **Complex Modifications**
   - Generate initial quote
   - Add tax: "add 9% sales tax"
   - Add discount: "apply 10% discount to labor items"
   - Remove item: "remove item 3"
   - Update quantity: "change item 1 quantity to 20"

3. **Product Recommendations**
   - Provide vague scope
   - AI should ask about specifics
   - AI should suggest products
   - AI should offer alternatives

4. **Empty Price Book**
   - Clear price book
   - Start chat
   - Should get helpful message about adding products

5. **Conversation Persistence**
   - Start conversation
   - Leave project
   - Come back
   - Messages should persist
   - Context should remain

## Configuration

### Environment Variables

```env
OPENAI_API_KEY=your-openai-api-key
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### AI Model Settings

Located in `app/api/chat/route.ts`:

```typescript
model: "gpt-4o",
temperature: 0.7,        // Balance creativity/consistency
max_tokens: 1200-2000,   // Dynamic based on request
presence_penalty: 0.3,   // Encourage varied responses
frequency_penalty: 0.3,  // Reduce repetition
```

### Product Context Limit

Currently loads first 50 products into AI context. Adjust if needed:

```typescript
const productContext = products.slice(0, 50).map(...);
```

## Future Enhancements

Potential improvements:

1. **Voice Input** 🎤
   - Implement speech-to-text
   - Allow voice commands
   - Voice quote reading

2. **Real-time Quote Preview** 👁️
   - Show quote building as you type
   - Live calculations
   - Side-by-side view

3. **Advanced Parsing** 📝
   - Better table extraction
   - Handle more formats
   - Parse uploaded documents

4. **Quote Comparison** ⚖️
   - Compare multiple versions
   - Show what changed
   - Track revisions

5. **Smart Suggestions** 💡
   - Based on past quotes
   - Industry standards
   - Seasonal pricing

6. **Multi-language Support** 🌍
   - Spanish, French, etc.
   - Auto-translation
   - Localized currencies

## Troubleshooting

### Common Issues

**Issue: AI not responding**
- Check OpenAI API key
- Check console for errors
- Verify network connection

**Issue: Quote not parsing**
- Check quote format
- Ensure all required fields
- Review parser regex patterns

**Issue: Products not appearing**
- Verify price book has products
- Check product query limit
- Review product families

**Issue: Context not persisting**
- Check Supabase connection
- Verify messages table
- Check project ID

## Performance Considerations

- **Message History**: Limited to last 15 messages for API
- **Product Context**: First 50 products loaded
- **Token Optimization**: Dynamic based on request type
- **Database Queries**: Indexed for performance
- **UI Updates**: Optimistic rendering

## Success Metrics

Track these to measure effectiveness:

1. **Conversation Length**: Average messages to quote
2. **Quote Commit Rate**: % of quotes committed
3. **Modification Frequency**: Average edits per quote
4. **Time to Quote**: Minutes from start to commit
5. **User Satisfaction**: Feedback and ratings

## Support

For issues or questions:
- Check console logs
- Review error messages
- Test with simple scenarios
- Check database connectivity

---

Built with ❤️ for Quote Tree AI
Last Updated: November 4, 2025




