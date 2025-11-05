# Split-Screen Chat Implementation

## Overview
Implemented a new split-screen chat interface that enhances the quote-building workflow with real-time product suggestions and quote preview.

## Features Implemented

### 1. **Dynamic Split-Screen Layout**
- Chat starts in full-screen mode
- After user sends first message, screen splits into:
  - **Left side (50%)**: Conversational AI chat
  - **Right side (50%)**: Tabbed interface with "Suggested Products" and "Preview"

### 2. **AI Response Format with Checklist**
- AI now responds with structured format showing:
  - **Work Summary**: Checklist (✓) of what the AI understood/did
  - **Recommended Products**: Numbered list with format: `Product Name - Qty: X, Price: $XX.XX each = $XXX.XX`
  - **Clarifying Questions**: Follow-up questions or confirmation

### 3. **Suggested Products Tab**
- Displays all AI-recommended products in a clean card layout
- Shows for each product:
  - Product name
  - Description
  - Quantity
  - Unit price
  - Line total
- **"Apply Changes to Quote"** button at bottom

### 4. **Preview Tab**
- Initially empty with message: "No preview available yet"
- After clicking "Apply Changes to Quote":
  - Shows full quote preview with:
    - All line items with quantities and prices
    - Subtotal
    - Tax (if applicable)
    - Discount (if applicable)
    - **Total** in bold
- **"Submit Quote"** button to finalize

### 5. **Quote Submission & Chat Reset**
- "Submit Quote" button:
  - Saves quote to database
  - Generates quote number (Q-0001, Q-0002, etc.)
  - Creates quote items in database
  - **Clears all chat history for that project**
  - Shows fresh welcome message
  - Resets split view to prepare for next quote

### 6. **Auto-Tab Switching**
- When AI suggests new products, automatically switches to "Suggested Products" tab
- User can manually switch between tabs anytime

## Technical Changes

### New Files
- `components/SplitChatPanel.tsx` - Main split-screen chat component

### Modified Files
- `components/ProjectWorkspace.tsx` - Updated to use SplitChatPanel instead of ChatPanel
- `app/api/chat/route.ts` - Modified to:
  - Return structured product data alongside conversational message
  - Parse AI responses for product recommendations
  - Include checklist format instructions in system prompt

### API Response Structure
```json
{
  "message": "AI conversational response with checklist format",
  "products": [
    {
      "product_name": "Product Name",
      "description": "",
      "quantity": 5,
      "unit_price": 25.00,
      "line_total": 125.00
    }
  ],
  "hasProducts": true
}
```

## User Flow

1. **Start**: User describes scope of work
2. **AI Responds**: Shows checklist of understanding + asks clarifying questions
3. **Iterate**: User provides more details
4. **Recommendations**: AI suggests products (appears in "Suggested Products" tab)
5. **Review**: User reviews suggested products
6. **Apply**: User clicks "Apply Changes to Quote"
7. **Preview**: Quote preview appears in "Preview" tab
8. **Submit**: User clicks "Submit Quote"
9. **Complete**: Quote saved, chat cleared, ready for next quote

## Benefits
- ✅ Clearer workflow with visual feedback
- ✅ Easy to review products before committing
- ✅ Preview quote before final submission
- ✅ Clean separation between conversation and quote building
- ✅ Chat history automatically managed per quote
- ✅ More intuitive for users building multiple quotes

## Next Steps (Optional Enhancements)
- Add ability to edit quantities/prices in Suggested Products tab
- Add ability to remove individual products before applying
- Allow adding tax/discount from the preview tab
- Add quote export (PDF) directly from preview
- Show quote history in preview tab after submission

