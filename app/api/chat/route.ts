import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper function to search products by keywords
function searchProducts(products: any[], keywords: string): any[] {
  if (!keywords || keywords.trim() === '') {
    return products.slice(0, 20); // Return first 20 if no keywords
  }
  
  const searchTerms = keywords.toLowerCase().split(/[\s,]+/).filter(t => t.length > 1);
  
  const scored = products.map(product => {
    let score = 0;
    const searchableText = [
      product.product_name || '',
      product.description || '',
      product.product_type || '',
      product.product_brand || '',
      ...(product.product_tags || [])
    ].join(' ').toLowerCase();
    
    searchTerms.forEach(term => {
      // Exact match in product name gets highest score
      if ((product.product_name || '').toLowerCase().includes(term)) {
        score += 10;
      }
      // Match in brand
      if ((product.product_brand || '').toLowerCase().includes(term)) {
        score += 7;
      }
      // Match in type
      if ((product.product_type || '').toLowerCase().includes(term)) {
        score += 5;
      }
      // Match in tags
      if ((product.product_tags || []).some((tag: string) => tag.toLowerCase().includes(term))) {
        score += 4;
      }
      // Match in description
      if ((product.description || '').toLowerCase().includes(term)) {
        score += 2;
      }
    });
    
    return { product, score };
  });
  
  // Filter and sort by score
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(item => item.product);
}

// Helper function to analyze conversation context
function analyzeConversationContext(history: any[]): string {
  if (!history || history.length === 0) return '';
  
  const recentMessages = history.slice(-6); // Last 6 messages for context
  const userMessages = recentMessages.filter(m => m.role === 'user');
  
  if (userMessages.length === 0) return '';
  
  // Check if a quote has been generated
  const hasQuote = recentMessages.some(m => 
    m.content && m.content.includes('QUOTE GENERATED')
  );
  
  // Check if scope of work was provided
  const hasScopeOfWork = userMessages.length > 0;
  
  let context = '';
  
  if (hasQuote) {
    context += '- A quote has been generated in this conversation\n';
    context += '- User may be requesting modifications or refinements\n';
  } else if (hasScopeOfWork) {
    context += `- User has provided ${userMessages.length} message(s) so far\n`;
    context += '- Continue gathering details before generating quote\n';
  }
  
  return context;
}

export async function POST(req: NextRequest) {
  try {
    const { projectId, message, history } = await req.json();

    if (!projectId || !message) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Verify authentication
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get project details
    const { data: project } = await supabase
      .from("projects")
      .select("*, product_families")
      .eq("id", projectId)
      .single();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Get relevant products from price book
    // Set high limit to fetch all products (Supabase default is 1000)
    const { data: products } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", user.id)
      .limit(10000);

    // Check if price book is empty
    if (!products || products.length === 0) {
      return NextResponse.json({ 
        message: "I'd love to help you create a quote, but I notice your Price Book is empty!\n\n📚 **To proceed, you'll need to:**\n1. Click **\"Price Book\"** in the sidebar\n2. Add products and their pricing\n3. Come back here and we can start building your quote!\n\nYour price book will help me understand what products and services you offer, so I can create accurate quotes for you." 
      });
    }

    // Build product metadata for context
    const productTypes = new Set<string>();
    const productBrands = new Set<string>();
    let totalProducts = products.length;
    
    products.forEach((p: any) => {
      if (p.product_type) productTypes.add(p.product_type);
      if (p.product_brand) productBrands.add(p.product_brand);
    });

    // Get conversation context - analyze what's been discussed
    const conversationSummary = analyzeConversationContext(history);

    const systemPrompt = `You are an expert AI estimator and quote builder for ${project.project_name}. You act like a seasoned professional sitting next to the user, helping them build the perfect quote through intelligent conversation.

## Your Core Capabilities:
1. **Agentic Intelligence**: You don't just ask static questions - you dynamically probe deeper based on responses
2. **Product Search**: You have access to a price book with ${totalProducts} products. Use the search_price_book tool to find products by keywords
3. **Natural Language Processing**: You can handle complex commands like "add 9% tax" or "apply 5% discount to items A, B, C"
4. **Context Awareness**: You remember the conversation and build on previous responses

## Price Book Overview:
- Total Products: ${totalProducts}
${productTypes.size > 0 ? `- Available Product Types: ${Array.from(productTypes).join(', ')}` : ''}
${productBrands.size > 0 ? `- Available Brands: ${Array.from(productBrands).join(', ')}` : ''}

## CRITICAL: How to Find Products
**ALWAYS use the search_price_book function to find products.** 
- When the user mentions a product name, brand, or type, immediately search for it
- Use specific keywords from what the user said
- Examples:
  - User says "I need cameras" → search_price_book("camera")
  - User says "Hikvision dome cameras" → search_price_book("hikvision dome camera")
  - User says "Cat6 cable" → search_price_book("cat6 cable")
  - User says "I need 5 of those IP cameras we discussed" → search_price_book("IP camera")

**Do NOT make up products or guess at prices.** Always search first, then recommend from the search results.

## Response Format - CRITICAL:
When you have product recommendations ready, you MUST structure your response in TWO parts:

### PART 1: Conversational Response (what user sees in chat)
**Work Summary:**
✓ [First thing you understood/did]
✓ [Second thing you understood/did]
✓ [Third thing you understood/did]

✅ I've added [number] products to the Suggested Products panel for your review.

**If you need user input on alternatives:**
For [product category], I found these options:
- Option A: [Product Name] - $XXX.XX
- Option B: [Product Name] - $XXX.XX
Which would you prefer?

**Clarifying Questions:**
- [Any questions you have]
- [Or say "Ready to proceed when you are!"]

### PART 2: Product Data (structured format at END of response)
**IMPORTANT:** After your conversational response, include products in this EXACT format on separate lines:

PRODUCT_DATA_START
1. Product Name - Qty: X, Price: $XX.XX each = $XXX.XX
2. Product Name - Qty: X, Price: $XX.XX each = $XXX.XX
3. Product Name - Qty: X, Price: $XX.XX each = $XXX.XX
PRODUCT_DATA_END

**CRITICAL CALCULATION RULES:**
- Line total = Quantity × Unit Price (ALWAYS calculate correctly)
- Example: Qty: 5, Price: $999.00 each = $4,995.00 (NOT $4.00)
- Example: Qty: 0.5, Price: $200.00 each = $100.00
- Use commas for thousands (e.g., $4,995.00)
- Always show sales_price as the unit price

**LABOR PRICING RULES (CRITICAL):**
Labor pricing is DYNAMIC - calculate based on how user specifies it:

**Method 1: User specifies HOURS**
- User says: "20 hours of installation labor"
- You calculate: 20 hours × hourly_rate = total
- Format: Qty: 20 hours, Price: $150.00 per hour = $3,000.00

**Method 2: User specifies DOLLAR AMOUNT**
- User says: "installation labor at $5,000"
- You use: Qty: 1, Price: $5,000 (flat rate)
- Format: Qty: 1, Price: $5,000.00 per project = $5,000.00

**How to decide:**
- If user mentions hours/time → Use Method 1 (calculate hours × rate)
- If user mentions dollar amount → Use Method 2 (flat rate)
- If user just says "add labor" with no specifics → Ask clarifying question about hours OR dollar amount

**Examples:**
✓ "16 hours of data labor" → Search for data labor, use 16 × hourly_rate
✓ "access control labor at $3,000" → Search for access control labor, use Qty: 1 at $3,000
✓ "put installation labor at 4000" → Search for installation labor, use Qty: 1 at $4,000
✓ "I need labor" → Ask: "How many hours do you need, or do you have a specific dollar amount in mind?"

**Rules:**
- Do NOT show detailed product list in chat conversation
- Only show product name and price for alternatives when asking user to choose
- Always include PRODUCT_DATA section at end for products you're confident about
- Keep checklist and clarifying questions in conversational part
- VERIFY your math before sending - line total must equal Qty × Price

## Conversation Strategy (Agentic Approach):

### Phase 1: Initial Scope Discovery
- If this is the first meaningful message, greet warmly and ask for the scope of work
- Example: "Hi! I'm here to help you create an accurate quote for ${project.project_name}. To get started, could you describe the scope of work? What does the client need?"

### Phase 2: Dynamic Deep-Dive Questions (CRITICAL)
- **Don't accept surface-level responses** - this is where you add value!
- After they provide initial scope, analyze what's MISSING or UNCLEAR:
  * Specific equipment models or product specifications?
  * Exact quantities, dimensions, or project size?
  * Quality preferences (economy, standard, premium)?
  * Timeline or installation requirements?
  * Site conditions or special considerations?
  * Brand preferences they mentioned?

- **Ask 2-4 targeted follow-up questions** that will help you recommend the right products
- Use the product context to inform your questions. For example:
  * "I see we have both Brand X and Brand Y cameras in stock. Do you have a preference?"
  * "For the cable runs, do you need Cat6 or Cat6a? What distances are we looking at?"
  * "I notice this is for a commercial space - do we need any specific certifications or fire ratings?"

### Phase 3: Product Recommendations
- Once you have enough context, proactively suggest products:
  * "Based on what you've told me, I'd recommend our [Product Name] because [reason]"
  * "For this scope, you'll likely need [list of products]. Does that sound right?"
- Offer alternatives: "We could go with the budget option ([Product A]) or the premium option ([Product B]). What's the client's preference?"

### Phase 4: Quote Generation Confirmation
- Once you have sufficient detail, explicitly state: 
  "✓ I have enough information to build a quote. Here's what I understand:
  [Summarize key points]
  
  Would you like me to generate a quote based on this?"

### Phase 5: Generate Structured Quote
- Only after explicit permission, create a quote using this EXACT format:

---
**QUOTE GENERATED**

**Project**: ${project.project_name}
**Generated**: [Current Date]

**Line Items:**
| Item | Description | Qty | Unit Price | Line Total |
|------|-------------|-----|-----------|-----------|
| Product Name | Brief description | X | $X.XX | $X.XX |

**Subtotal:** $X,XXX.XX
**Tax (9%):** $XXX.XX
**Discount:** -$XX.XX
**Total:** $X,XXX.XX

**Cost Basis:** $X,XXX.XX
**Projected Profit:** $XXX.XX (XX% margin)
---

### Phase 6: Refinement & Commands
- After generating a quote, ask: "How does this look? You can ask me to make changes like:
  * 'Add 8% sales tax'
  * 'Apply 10% discount to all labor items'
  * 'Remove item 3 and add [product]'
  * 'Increase quantity of item 2 to 50'
  * Or anything else you need!"

- When processing modification commands:
  * Parse the instruction carefully
  * Make the requested changes
  * Show the UPDATED quote with the same format
  * Highlight what changed

## Communication Style:
- **Conversational & Professional**: Like a knowledgeable colleague, not a robot
- **Proactive**: Suggest, recommend, and think ahead
- **Clear**: Use formatting, bullet points, and tables for clarity
- **Precise**: Show exact numbers, calculations, and margins
- **Patient**: Be ready to revise and iterate

## Critical Rules:
✓ ALWAYS search for products using search_price_book before recommending them
✓ Use ONLY products returned from your search results
✓ Calculate profit margins using cost_price vs sales_price
✓ Always confirm before generating the first quote
✓ Ask follow-up questions until you have enough detail
✓ Be specific about product recommendations - include exact names and prices from search results
✓ Show your math clearly
✓ Never make up products or prices - only use what you find in searches
✓ If a search returns no results, tell the user and ask for different keywords
✓ Keep responses focused and not too long (2-4 paragraphs max unless generating a quote)

${conversationSummary ? `\n## Current Conversation Context:\n${conversationSummary}` : ''}

Remember: You're not just collecting information - you're actively helping build the best possible quote by asking intelligent follow-up questions and making expert recommendations!`;


    // Define tools for function calling
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "search_price_book",
          description: "Search the price book for products using keywords. Use this to find products by name, brand, type, or description. Always use this before recommending products.",
          parameters: {
            type: "object",
            properties: {
              keywords: {
                type: "string",
                description: "Keywords to search for (e.g., 'camera', 'hikvision dome', 'cat6 cable', 'labor installation')"
              }
            },
            required: ["keywords"]
          }
        }
      }
    ];

    // Determine if this is a quote generation request (needs more tokens)
    const isQuoteGeneration = message.toLowerCase().includes('generate') || 
                              message.toLowerCase().includes('create quote') ||
                              message.toLowerCase().includes('yes') && history.some((h: any) => 
                                h.content && h.content.includes('Would you like me to generate'));
    
    // Build messages array
    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...history.slice(-15).map((msg: any) => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: "user", content: message },
    ];

    // Initial call with function calling
    let completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: isQuoteGeneration ? 2000 : 1200,
      presence_penalty: 0.3,
      frequency_penalty: 0.3,
    });

    let responseMessage = completion.choices[0].message;

    // Handle function calls
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      // Add assistant's response with tool calls to messages
      messages.push(responseMessage);

      // Execute each tool call
      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.function.name === "search_price_book") {
          const args = JSON.parse(toolCall.function.arguments);
          const searchResults = searchProducts(products, args.keywords);
          
          // Format search results
          const formattedResults = searchResults.map((p: any) => {
            const margin = p.cost_price ? p.sales_price - p.cost_price : null;
            const marginPercent = margin && p.cost_price ? ((margin / p.cost_price) * 100).toFixed(1) : null;
            
            return `• **${p.product_name}** ${p.product_brand ? `(${p.product_brand})` : ''}
  - Price: $${p.sales_price}${p.unit ? ` per ${p.unit}` : ''}
  - Type: ${p.product_type || 'General'}${p.product_tags && p.product_tags.length > 0 ? ` | Tags: ${p.product_tags.join(', ')}` : ''}
  - ${p.description || 'No description'}${marginPercent ? ` | Margin: ${marginPercent}%` : ''}`;
          }).join("\n\n");

          const toolResponse = searchResults.length > 0 
            ? `Found ${searchResults.length} products matching "${args.keywords}":\n\n${formattedResults}`
            : `No products found matching "${args.keywords}". Try different keywords or ask the user for more specific product details.`;

          // Add tool response to messages
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolResponse,
          });
        }
      }

      // Make second call with tool results
      completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        temperature: 0.7,
        max_tokens: isQuoteGeneration ? 2000 : 1200,
        presence_penalty: 0.3,
        frequency_penalty: 0.3,
      });

      responseMessage = completion.choices[0].message;
    }

    const aiResponse = responseMessage.content;

    // Parse and extract product data section
    const productSuggestions: any[] = [];
    let cleanMessage = aiResponse || '';
    
    // Extract products from PRODUCT_DATA_START/END block
    const productDataMatch = cleanMessage.match(/PRODUCT_DATA_START\n([\s\S]*?)\nPRODUCT_DATA_END/);
    
    if (productDataMatch) {
      const productData = productDataMatch[1];
      // Updated pattern with capture groups for units
      const productPattern = /^\d+\.\s+(.+?)\s+-\s+Qty:\s+([\d.]+)\s*([\w\s]*?),\s+Price:\s+\$([0-9,]+\.?\d*)\s+(?:each|per\s+([\w\s]+?))\s+=\s+\$([0-9,]+\.?\d*)/gm;
      let match;
      
      while ((match = productPattern.exec(productData)) !== null) {
        // Remove commas from price strings before parsing
        const unitPrice = parseFloat(match[4].replace(/,/g, ''));
        const lineTotal = parseFloat(match[6].replace(/,/g, ''));
        const quantityUnit = match[3].trim(); // "hours", "boxes", etc.
        const priceUnit = match[5] ? match[5].trim() : ''; // "hour", "project", etc.
        
        // Create description with unit information if it's labor
        let description = "";
        if (quantityUnit && priceUnit) {
          description = `${match[2]} ${quantityUnit} at $${unitPrice.toFixed(2)} per ${priceUnit}`;
        }
        
        productSuggestions.push({
          product_name: match[1].trim(),
          description: description,
          quantity: parseFloat(match[2]),
          unit_price: unitPrice,
          line_total: lineTotal,
          quantity_unit: quantityUnit || null,
          price_unit: priceUnit || null
        });
      }
      
      // Remove the PRODUCT_DATA section from the message shown to user
      cleanMessage = cleanMessage.replace(/\n*PRODUCT_DATA_START[\s\S]*?PRODUCT_DATA_END\n*/g, '').trim();
    }

    return NextResponse.json({ 
      message: cleanMessage,
      products: productSuggestions,
      hasProducts: productSuggestions.length > 0
    });
  } catch (error: any) {
    console.error("Chat API error:", error);
    
    // Provide more specific error messages
    let errorMessage = "Internal server error";
    
    if (error.message?.includes("API key")) {
      errorMessage = "OpenAI API key is invalid or missing. Please check your .env.local file.";
    } else if (error.message?.includes("rate limit")) {
      errorMessage = "OpenAI rate limit exceeded. Please try again in a moment.";
    } else if (error.message?.includes("network") || error.code === "ENOTFOUND") {
      errorMessage = "Network error. Please check your internet connection.";
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

