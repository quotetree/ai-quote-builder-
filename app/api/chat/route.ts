import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const STRICT_KEYWORDS = ['bullet', 'dome', 'turret', 'cat6', 'cat5', 'cable'];
const STRICT_KEYWORD_SYNONYMS: Record<string, string[]> = {
  bullet: ['bullet'],
  dome: ['dome'],
  turret: ['turret'],
  cat6: ['cat6', 'cat 6'],
  cat5: ['cat5', 'cat 5'],
  cable: ['cable', 'cabling', 'wire'],
};

function searchProductsWithScores(products: any[], keywords: string): { product: any; score: number }[] {
  if (!keywords || keywords.trim() === '') {
    return products.slice(0, 20).map(product => ({ product, score: 0 }));
  }
  
  const normalizedKeywords = keywords.toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  const searchTerms = normalizedKeywords.split(/[\s,]+/).filter(t => t.length > 1);
  
  console.log('🔍 Search terms:', searchTerms);
  console.log('🏷️  Product types in database:', [...new Set(products.map(p => p.product_type).filter(Boolean))].slice(0, 10));
  
  const scored = products.map(product => {
    let score = 0;
    const productName = (product.product_name || '').toLowerCase().replace(/[-_]/g, ' ');
    const productBrand = (product.product_brand || '').toLowerCase().replace(/[-_]/g, ' ');
    const productType = (product.product_type || '').toLowerCase().replace(/[-_]/g, ' ');
    const description = (product.description || '').toLowerCase().replace(/[-_]/g, ' ');
    const combinedSearchText = `${productBrand} ${productName} ${productType} ${description}`.toLowerCase();
    
    const commonBrands = ['verkada', 'rhombus', 'hikvision', 'axis', 'hanwha', 'genetec', 'milestone'];
    const brandInSearch = searchTerms.find(term => commonBrands.includes(term));
    
    if (brandInSearch) {
      if (!productBrand.includes(brandInSearch)) {
        score -= 1000;
      } else {
        score += 200;
      }
    }
    
    const typeKeywords = ['access', 'control', 'intercom', 'camera', 'nvr', 'recorder', 'alarm', 'sensor'];
    const typeInSearch = searchTerms.filter(term => typeKeywords.includes(term));
    
    if (typeInSearch.length > 0) {
      const matchingTypeTerms = typeInSearch.filter(term => productType.includes(term));
      if (matchingTypeTerms.length === typeInSearch.length) {
        score += 300;
      } else if (matchingTypeTerms.length > 0) {
        score += 100;
      } else {
        score -= 200;
      }
    }
    
    let termsFoundInCombined = 0;
    let termsFoundInName = 0;
    searchTerms.forEach(term => {
      if (combinedSearchText.includes(term)) {
        termsFoundInCombined++;
      }
      if (productName.includes(term)) {
        termsFoundInName++;
      }
    });
    
    const compoundTerms: string[] = [];
    for (let i = 0; i < searchTerms.length - 1; i++) {
      compoundTerms.push(`${searchTerms[i]} ${searchTerms[i + 1]}`);
    }
    
    compoundTerms.forEach(compound => {
      if (combinedSearchText.includes(compound)) {
        score += 30;
      }
    });
    
    if (termsFoundInCombined === searchTerms.length) {
      score += 200;
    }
    
    if (termsFoundInName === searchTerms.length) {
      score += 100;
    }
    
    if (searchTerms.length >= 3 && termsFoundInCombined >= searchTerms.length - 1) {
      score += 75;
    }
    
    searchTerms.forEach(term => {
      if (productName.includes(term)) {
        score += 20;
        if (term.length > 4 && !['year', 'years', 'license'].includes(term)) {
          score += 15;
        }
      }
      
      if (productBrand.includes(term)) {
        score += 15;
      }
      
      if (productType.includes(term)) {
        score += 25;
      }
      
      if (combinedSearchText.includes(term)) {
        score += 5;
      }
      
      if ((product.product_tags || []).some((tag: string) => tag.toLowerCase().includes(term))) {
        score += 4;
      }
      
      if (description.includes(term)) {
        score += 2;
      }
    });
    
    const criticalTerms = searchTerms.filter(t => t.length > 4 && !['year', 'years', 'license'].includes(t));
    const brandTerms = searchTerms.filter(t => commonBrands.includes(t));
    
    const strictTerms = searchTerms.filter(t => STRICT_KEYWORDS.includes(t));
    strictTerms.forEach(term => {
      const synonyms = STRICT_KEYWORD_SYNONYMS[term] || [term];
      const matchesStrict = synonyms.some(syn => combinedSearchText.includes(syn));
      if (!matchesStrict) {
        score -= 250;
      }
    });
    
    criticalTerms.forEach(term => {
      if (!brandTerms.includes(term) && !combinedSearchText.includes(term)) {
        score -= 30;
      }
    });
    
    return { product, score };
  });
  
  const sorted = scored.sort((a, b) => b.score - a.score);
  const positive = sorted.filter(item => item.score > 0);
  const filtered = positive.length >= 5 ? positive : sorted.slice(0, 20);
  
  const criticalTerms = searchTerms.filter(t => t.length > 4 && !['year', 'years', 'license'].includes(t));
  if (criticalTerms.length > 0) {
    const withCriticalTerms = filtered.filter(item => {
      const combined = `${(item.product.product_brand || '').toLowerCase()} ${(item.product.product_name || '').toLowerCase()} ${(item.product.product_type || '').toLowerCase()}`.replace(/[-_]/g, ' ');
      return criticalTerms.every(term => combined.includes(term));
    });
    
    if (withCriticalTerms.length > 0) {
      const others = filtered.filter(item => {
        const combined = `${(item.product.product_brand || '').toLowerCase()} ${(item.product.product_name || '').toLowerCase()} ${(item.product.product_type || '').toLowerCase()}`.replace(/[-_]/g, ' ');
        return !criticalTerms.every(term => combined.includes(term));
      });
      
      return [
        ...withCriticalTerms.sort((a, b) => b.score - a.score),
        ...others.sort((a, b) => b.score - a.score)
      ]
        .slice(0, 20);
    }
  }
  
  const results = filtered
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  
  console.log(`📦 Found ${results.length} products. Top 5 with types:`, results.slice(0, 5).map(item => ({
    name: item.product.product_name,
    type: item.product.product_type,
    brand: item.product.product_brand,
    score: item.score
  })));
  
  return results;
}

function searchProducts(products: any[], keywords: string): any[] {
  return searchProductsWithScores(products, keywords).map(item => item.product);
}

interface RequestedItem {
  item: string;
  quantity?: number;
  unit?: string | null;
  budget?: number | null;
  rawText?: string;
  keywords?: string;
}

interface UnfulfilledRequest {
  requestedText: string;
  reason: string;
}

const MATCH_CONFIDENCE_THRESHOLD = 120;

function matchRequestsToPriceBook(requestedItems: RequestedItem[], products: any[]) {
  const suggestionsMap = new Map<string, any>();
  const unfulfilled: UnfulfilledRequest[] = [];

  if (!requestedItems || requestedItems.length === 0) {
    return { suggestions: [], unfulfilled };
  }

  requestedItems.forEach((request) => {
    const keywords = (request.keywords || request.item || request.rawText || '').trim();
    if (!keywords) {
      unfulfilled.push({
        requestedText: request.item || request.rawText || 'Unknown item',
        reason: 'No recognizable keywords were provided for matching',
      });
      return;
    }

    const results = searchProductsWithScores(products, keywords);
    const top = results[0];

    if (top && top.score >= MATCH_CONFIDENCE_THRESHOLD) {
      const product = top.product;
      const key = product.id || product.product_name?.toLowerCase().trim();
      const requestedQuantity = typeof request.quantity === 'string' ? parseFloat(request.quantity) : request.quantity;
      const quantityValue = Number(requestedQuantity);
      const quantity = Number.isFinite(quantityValue) && quantityValue > 0 ? quantityValue : 1;
      const parsedBudget = typeof request.budget === 'string' ? parseFloat(request.budget) : request.budget;
      const unitPrice = Number(product.sales_price || product.unit_price || product.price || 0);
      const hasBudget = typeof parsedBudget === 'number' && !isNaN(parsedBudget) && parsedBudget > 0;
      const computedLineTotal = hasBudget
        ? Number(parsedBudget)
        : unitPrice * quantity;
      const derivedUnitPrice = hasBudget ? Number(parsedBudget) / quantity : unitPrice;

      if (suggestionsMap.has(key)) {
        const existing = suggestionsMap.get(key);
        existing.quantity += quantity;
        existing.line_total += computedLineTotal;
        existing.unit_price = existing.quantity > 0 ? existing.line_total / existing.quantity : existing.unit_price;
        existing.matched_requests.push(request.item || keywords);
      } else {
        suggestionsMap.set(key, {
          product_id: product.id,
          product_name: product.product_name,
          description: product.description,
          quantity,
          unit_price: Number(derivedUnitPrice.toFixed(2)),
          line_total: Number(computedLineTotal.toFixed(2)),
          quantity_unit: request.unit || product.unit || null,
          price_unit: product.unit || null,
          product_brand: product.product_brand,
          product_type: product.product_type,
          match_confidence: top.score,
          matched_requests: [request.item || keywords],
        });
      }
    } else {
      unfulfilled.push({
        requestedText: request.item || request.rawText || keywords,
        reason: top
          ? `Closest match "${top.product.product_name}" scored ${Math.round(top.score)} (needs ≥ ${MATCH_CONFIDENCE_THRESHOLD})`
          : 'No matching product found in price book',
      });
    }
  });

  const suggestions = Array.from(suggestionsMap.values());
  return { suggestions, unfulfilled };
}

function buildWorkSummaryText(suggestions: any[], unfulfilled: UnfulfilledRequest[]) {
  const lines: string[] = [];
  lines.push('**Work Summary:**');

  if (suggestions.length === 0) {
    lines.push('• No products were added yet.');
  } else {
    suggestions.forEach((item) => {
      const qtyUnit = item.quantity_unit ? ` ${item.quantity_unit}` : '';
      const amount =
        typeof item.line_total === 'number' && item.line_total > 0
          ? ` — $${item.line_total.toFixed(2)}`
          : '';
      lines.push(`✓ Added ${item.product_name} (Qty: ${item.quantity}${qtyUnit})${amount}`);
    });
  }

  if (unfulfilled.length > 0) {
    lines.push('');
    lines.push("**Couldn't Add (Not Found in Price Book):**");
    unfulfilled.forEach((item) => {
      lines.push(`❌ ${item.requestedText} — ${item.reason}`);
    });
  }

  return lines.join('\n');
}

function stripExistingWorkSummary(message: string): string {
  const workSummaryRegex = /work summary:[\s\S]*?(?=(next steps|$))/i;
  return message.replace(workSummaryRegex, '').trim();
}

// Helper function to analyze conversation context
function analyzeConversationContext(history: any[]): string {
  if (!history || history.length === 0) return '';
  
  const recentMessages = history.slice(-6); // Last 6 messages for context
  const userMessages = recentMessages.filter(m => m.role === 'user');
  
  if (userMessages.length === 0) return '';
  
  // Check if products have been suggested
  const hasProducts = recentMessages.some(m => 
    m.content && m.content.includes('PRODUCT_DATA_START')
  );
  
  // Check if scope of work was provided
  const hasScopeOfWork = userMessages.length > 0;
  
  let context = '';
  
  if (hasProducts) {
    context += '- Products have been suggested in this conversation\n';
    context += '- User may be requesting modifications, additions, or refinements\n';
  } else if (hasScopeOfWork) {
    context += `- User has provided ${userMessages.length} message(s) so far\n`;
    context += '- Continue gathering details and finding appropriate products\n';
  }
  
  return context;
}

export async function POST(req: NextRequest) {
  // Check if request was aborted
  const signal = req.signal;
  
  try {
    // Early abort check
    if (signal.aborted) {
      console.log('🛑 Request already aborted, not processing');
      return NextResponse.json({ error: "Request aborted" }, { status: 499 });
    }

    const { projectId, message, history, runId, poolId, contextId, currentState, clearContext } = await req.json();

    if (!projectId || !message) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }
    
    console.log(`🏊 pool:start { poolId: "${poolId || 'none'}", runId: "${runId || 'none'}", contextId: "${contextId || 'none'}", projectId: "${projectId}" }`);
    console.log(`🔒 context:isolated { contextId: "${contextId}", clearContext: ${clearContext}, hasCurrentState: ${!!currentState} }`);
    
    // Set up abort listener
    let aborted = false;
    const abortHandler = () => {
      aborted = true;
      console.log(`🛑 Request aborted mid-processing - Project: ${projectId}, RunID: ${runId || 'none'}`);
    };
    signal.addEventListener('abort', abortHandler);

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

    // Check if project is in edit mode
    const { data: workingState } = await supabase
      .from("project_working_state")
      .select("edit_mode, current_edit_session_id, current_quote_id, quote_preview")
      .eq("project_id", projectId)
      .single();
    
    const isEditMode = workingState?.edit_mode || false;
    const editSessionId = workingState?.current_edit_session_id || null;
    const editQuoteId = workingState?.current_quote_id || null;
    
    if (isEditMode && editSessionId) {
      console.log(`📝 edit:context { sessionId: "${editSessionId}", quoteId: "${editQuoteId}", instruction: "${message.substring(0, 50)}..." }`);
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

    // Build edit mode context if applicable
    let editModeContext = '';
    if (isEditMode && workingState?.quote_preview) {
      const quotePreview = workingState.quote_preview as any;
      editModeContext = `

## 🔧 EDIT MODE - CRITICAL INSTRUCTIONS:

**You are currently in EDIT MODE for an existing quote.**

**Current Quote Contents:**
${quotePreview.line_items?.map((item: any, idx: number) => 
  `${idx + 1}. ${item.product_name} - Qty: ${item.quantity}, Price: $${item.unit_price} each = $${item.line_total}`
).join('\n') || 'No items'}

**Subtotal:** $${quotePreview.subtotal}
**Tax:** $${quotePreview.tax_amount} (${(quotePreview.tax_rate * 100).toFixed(1)}%)
**Total:** $${quotePreview.total_price}

**EDIT MODE RULES:**
1. The user is modifying an EXISTING quote
2. When they ask to "add" or "remove" items, they mean modify the quote above
3. DO NOT suggest products from scratch - modify what exists
4. If user says "increase labor to $X" → find labor item above and update it
5. If user says "add X" → add X to the list above
6. If user says "remove X" → remove X from the list above
7. ALWAYS return ALL items (existing + new - removed) in PRODUCT_DATA section
8. Session ID: ${editSessionId}
9. This is a stateless operation - work only from the quote preview above

`;
    }

    const systemPrompt = `You are an expert AI estimator and quote builder for ${project.project_name}.
${editModeContext}
## ⚠️ CRITICAL RULES - READ CAREFULLY:

**RULE #1:** Each of your responses REPLACES the previous product suggestions. Never accumulate or combine products from multiple messages.

**RULE #2:** ONLY include products the user mentions in their CURRENT message. Ignore all previous messages completely when building PRODUCT_DATA.

**RULE #3:** EVERY response where user asks for products MUST end with:
PRODUCT_DATA_START
1. Product Name - Qty: X, Price: $XXX each = $XXX
PRODUCT_DATA_END

**RULE #4:** AFTER the PRODUCT_DATA block you MUST output \`REQUEST_DATA_START\` / \`REQUEST_DATA_END\` containing a VALID JSON array that summarizes EXACTLY what the user asked for in THIS message. Each object must include: 
\`"item"\` (string), \`"quantity"\` (number), \`"unit"\` (string or null), \`"budget"\` (number or null), \`"rawText"\` (the exact words the user used), and optional \`"keywords"\`.

Example:
REQUEST_DATA_START
[
  { "item": "Verkada bullet cameras", "quantity": 4, "unit": "cameras", "budget": null, "rawText": "4 Verkada bullet cameras", "keywords": "Verkada bullet camera" },
  { "item": "Miscellaneous material", "quantity": 1, "unit": null, "budget": 150, "rawText": "$150 in misc material", "keywords": "miscellaneous material" }
]
REQUEST_DATA_END

## ❌ WRONG EXAMPLES (DO NOT DO THIS):

**Message 1:** "I need cable and mount"
→ You suggest: cable, mount
**Message 2:** "I need a 5-year license"  
→ ❌ WRONG: Suggesting cable, mount, AND license (7 products total)
→ ✅ RIGHT: Suggest ONLY the 5-year license (1 product)

**Message 1:** "I need 5 products"
→ You suggest: 5 products
**Message 2:** "I need just the license"
→ ❌ WRONG: Including any of the 5 products from message 1
→ ✅ RIGHT: Suggest ONLY the license mentioned in message 2

**Step-by-step workflow (MANDATORY):**
1. Read ONLY the user's current message
2. Identify products mentioned in THIS message (ignore conversation history)
3. Search for ONLY those products: search_price_book("product name")
4. Write response: Work Summary + Next Steps
5. Add PRODUCT_DATA_START with ONLY the products from step 3
6. End with PRODUCT_DATA_END

**DO NOT:**
- Include products from previous messages
- Try to "remember" or "maintain" a product list
- Combine products from multiple messages
- Think about what was suggested before

**Each message = Fresh start. Only suggest what's in the current message.**

**Example:**
Current message: "I need one 5-year Verkada intercom license"
Your PRODUCT_DATA section: ONLY that 1 license (not 5 products from history)

## Your Core Capabilities:
1. **Agentic Intelligence**: You don't just ask static questions - you dynamically probe deeper based on responses
2. **Product Search**: You have access to a price book with ${totalProducts} products. Use the search_price_book tool to find products by keywords
3. **Natural Language Processing**: You can handle complex commands like "add 9% tax" or "apply 5% discount to items A, B, C"
4. **Context Awareness**: You remember the conversation and build on previous responses

## Price Book Overview:
- Total Products: ${totalProducts}
${productTypes.size > 0 ? '- Available Product Types: ' + Array.from(productTypes).join(', ') : ''}
${productBrands.size > 0 ? '- Available Brands: ' + Array.from(productBrands).join(', ') : ''}

## CRITICAL: How to Find Products
**ALWAYS use the search_price_book function to find products.** 
- When the user mentions a product, search using ALL the important keywords they mentioned
- **Include the BRAND if user specifies it** - this is CRITICAL for accurate results
- Include the product type and duration
- The search is smart and will match across product name, type, and brand

**Examples:**
- User: "I need cameras" → search_price_book("camera")
- User: "Hikvision dome cameras" → search_price_book("hikvision dome camera")
- User: "Verkada 5-year intercom license" → search_price_book("verkada 5 year intercom license")
- User: "Verkada 3-year access control license" → search_price_book("verkada 3 year access control license")
- User: "8 Verkada 3-year access control licenses" → search_price_book("verkada 3 year access control license")

**CRITICAL:** When user specifies a brand (Verkada, Rhombus, etc.), ALWAYS include it in your search!
- ❌ BAD: User says "Verkada 3-year access control license" → You search "3-year access control license" (missing brand!)
- ✅ GOOD: User says "Verkada 3-year access control license" → You search "verkada 3 year access control license"

**CRITICAL - PRODUCT TYPES:** The search looks across product name, brand, AND product type fields!

Examples of how this works:
- Product: "Door License" (name) + "Access Control" (type) + "Verkada" (brand)
- User searches: "Verkada access control license" → PERFECT MATCH!
- User searches: "Verkada door license" → PERFECT MATCH!

So when user says "access control" or "intercom" or "camera", include those words in your search even if you think the product might be named differently!

**CRITICAL: Selecting Products from Search Results**

**IMPORTANT:** If your search returns products, YOU MUST SUGGEST THEM. Do NOT say "not found" when the search returns results!

When you search and get results back:
1. **The search results are VALID products** - they were found in the price book
2. **Look at the product names in the results** - if any match what the user asked for, USE IT
3. **Be flexible with word order** - "5-Year Intercom License" matches "5-year intercom license" request
4. **DO NOT reject good matches** - if it has the key terms (intercom, camera, etc.), it's a match!

**Examples:**
- User: "5-year intercom license" 
- Search finds: "Verkada 5-Year Intercom License" at $1,749
- ✅ **CORRECT:** Add this to PRODUCT_DATA section immediately!
- ❌ **WRONG:** Saying "not found" when it's right there!

- User: "intercom license"
- Search finds: "3-Year Intercom License" ($599), "5-Year Intercom License" ($1,749), "10-Year Intercom License" ($2,999)
- ✅ **CORRECT:** Suggest the 5-year (middle option) OR ask which duration they prefer
- ❌ **WRONG:** Saying "not found" or "no exact match"

**GOLDEN RULE: If search returns products with the key terms (intercom, camera, etc.) → USE THE FIRST GOOD MATCH!**
**Don't overthink it. Don't say "not found". Just use the product from the search results!**

## Response Format - CRITICAL:
Your response MUST be structured in TWO parts:

### PART 1: Conversational Response (what user sees in chat)
Keep this CLEAN and SIMPLE. Format exactly like this:

**Work Summary:**
✓ [First item you found/understood/did]
✓ [Second item]
✓ [Third item]

**Next Steps:**
[Simple question asking if this is correct or if they need anything else]

**STOP HERE** - Do not add any more text after "Next Steps"

**IMPORTANT RULES for chat responses:**
- Use **bold** for section headers (Work Summary, Next Steps)
- Format Work Summary as a LIST with checkmarks (✓) when you have multiple items
- If only one simple thing happened, a single sentence is fine
- Do NOT use ### or markdown headers
- Do NOT list products in the chat
- Do NOT show prices or quantities in the chat
- Do NOT write "Product Data:" or mention PRODUCT_DATA in the chat
- Keep it conversational and brief
- Just mention you've added items to Suggested Products panel

### PART 2: Product Data (INVISIBLE to user - structured format at END)

🚨 **THIS IS MANDATORY - NOT OPTIONAL** 🚨

If you mention a product in your Work Summary, you MUST include the PRODUCT_DATA section.

**NO EXCEPTIONS. THIS IS HOW THE APP WORKS. WITHOUT THIS, THE USER SEES NOTHING.**

Format (copy this exactly):

PRODUCT_DATA_START
1. Product Name - Qty: X, Price: $XX.XX each = $XXX.XX
PRODUCT_DATA_END

**WRONG (don't do this):**
Work Summary: ✓ Added 5-year license
Next Steps: Does this work?
[END - NO PRODUCT_DATA = BROKEN]

**RIGHT (do this):**
**Work Summary:**
✓ Added 5-year license

**Next Steps:**
Does this work?

PRODUCT_DATA_START
1. Verkada 5-Year License - Qty: 1, Price: $999.00 each = $999.00
PRODUCT_DATA_END

**If you don't include PRODUCT_DATA, the Suggested Products panel will be empty and the app breaks.**

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
- Products go in PRODUCT_DATA section ONLY, never in chat text
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
- Once you have enough context, search for products and add them to PRODUCT_DATA section
- In your chat response, keep it simple:
  * "Based on what you described, I've added some products to the Suggested Products panel for your review"
  * Don't list product names or prices in the chat
  * If you need to ask about alternatives, ask generally: "For the cameras, do you prefer budget or premium options?"
- The user will see all product details in the Suggested Products panel

### Phase 4: Product Recommendations & Building the Quote
- Once you have sufficient detail and have searched for products:
  * Provide a work summary of what you understood
  * Add products to the PRODUCT_DATA section
  * Tell the user you've added products to the Suggested Products panel
  * Ask if they need any changes or if they're ready to proceed

- The user will review products in the Suggested Products panel and apply them to preview the quote
- You DON'T generate quote tables or show pricing details in the chat
- Keep your responses focused on understanding their needs and finding the right products

### Phase 5: Refinement & Iteration

## 🚨 CRITICAL RULE - READ THIS CAREFULLY:
**ONLY suggest products mentioned in the user's CURRENT message. DO NOT re-suggest products from previous messages.**

If user says: "I need a 5-year license and Cat6 riser cable"
- Search for: 5-year license and Cat6 riser cable
- PRODUCT_DATA: Include ONLY those 2 products
- Do NOT include: Any products from earlier messages (even if they were just suggested)

**MANDATORY WORKFLOW**:
1. Read the user's CURRENT message
2. Identify ONLY the products they mention in THIS message
3. Search for those specific products only
4. Include ONLY those products in PRODUCT_DATA
5. Ignore products from conversation history - they're not in the current request

**Example - User asks for change:**

User: "I need a 5-year license instead of 1-year, and Cat6 riser instead of regular Cat6"

Your response:
**Work Summary:**
✓ Updated to 5-Year License
✓ Added Cat6 Riser Cable

**Next Steps:**
Are these the correct products?

PRODUCT_DATA_START
1. Verkada 5-Year License - Qty: 1, Price: $999.00 each = $999.00
2. Cat6 Riser Cable - Qty: 1, Price: $225.00 each = $225.00
PRODUCT_DATA_END

**Notice**: ONLY the 2 products mentioned in current message. NOT all products from conversation history.

## Communication Style:
- **Conversational & Professional**: Like a knowledgeable colleague, not a robot
- **Proactive**: Suggest, recommend, and think ahead
- **Clear & Concise**: Keep chat responses brief - work summary + next steps question
- **Focused**: Understanding needs and finding products, not showing quote details in chat
- **Patient**: Be ready to revise and iterate

## Critical Rules:
✓ **YOUR RESPONSE REPLACES PREVIOUS SUGGESTIONS - DO NOT ACCUMULATE PRODUCTS**
✓ **ONLY suggest products mentioned in the CURRENT user message - COMPLETELY IGNORE conversation history when building PRODUCT_DATA**
✓ If user says "I need X", your PRODUCT_DATA includes ONLY X (not X + products from previous messages)
✓ ALWAYS search for products using search_price_book before recommending them
✓ Use ONLY products returned from your search results
✓ **IF YOU SEARCH FOR A PRODUCT AND FIND IT → YOU MUST INCLUDE IT IN PRODUCT_DATA SECTION**
✓ Each message is independent - treat it as a fresh request with no memory of previous products
✓ NEVER show product lists, prices, or quote tables in chat responses
✓ Products only appear in chat via the PRODUCT_DATA section, never in conversational text
✓ Keep chat responses brief: work summary + simple next steps question
✓ Never make up products or prices - only use what you find in searches
✓ If a search returns no results, tell the user and ask for different keywords
✓ Keep responses focused and brief (2-3 paragraphs max)

${conversationSummary ? '\n## Current Conversation Context:\n' + conversationSummary : ''}

## 🚨 FINAL CHECKLIST BEFORE YOU RESPOND:
1. Did you search for products? YES → Check what the search returned
2. **Did the search return ANY products?** 
   - YES → You MUST suggest them (don't say "not found")
   - NO → Tell user to try different keywords
3. Are you including ONLY products from the CURRENT message? (NOT from history)
4. Does your response end with PRODUCT_DATA_START and PRODUCT_DATA_END? If NO, ADD IT NOW.

**CRITICAL MISTAKES TO AVOID:**
❌ Search returns "Verkada 5-Year Intercom License" → You say "not found" (WRONG!)
❌ Search returns results → You reject them because word order is different (WRONG!)
❌ User asks for 1 product → You include 5 products from conversation history (WRONG!)

**CORRECT BEHAVIOR:**
✅ Search returns products → Suggest the best match from results
✅ "5-Year Intercom License" matches request for "5-year intercom license" (word order doesn't matter)
✅ User asks for 1 product → Include ONLY that 1 product from CURRENT message

**If the search found products, USE THEM. Don't overthink it!**`;


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

    // All responses should be concise now - no quote generation in chat
    const isComplexRequest = message.length > 200; // Longer user messages might need more tokens
    
    // CRITICAL: Build context isolation instructions
    let contextInstructions = `\n\n## 🔒 CONTEXT ISOLATION - READ THIS FIRST\n\n`;
    contextInstructions += `**SESSION ID:** ${contextId || 'none'}\n`;
    contextInstructions += `**CLEAR CONTEXT MODE:** ${clearContext ? 'ENABLED - Ignore all previous session memory' : 'DISABLED'}\n\n`;
    
    if (currentState) {
      contextInstructions += `**📊 CURRENT WORKING STATE (ONLY SOURCE OF TRUTH):**\n`;
      
      if (currentState.hasExistingQuote && currentState.quotePreview?.line_items) {
        contextInstructions += `\n**Current Quote Preview (${currentState.quotePreview.line_items.length} items):**\n`;
        currentState.quotePreview.line_items.forEach((item: any, idx: number) => {
          contextInstructions += `${idx + 1}. ${item.product_name} - Qty: ${item.quantity}, Price: $${item.line_total}\n`;
        });
      } else {
        contextInstructions += `**Current Quote Preview:** EMPTY (no items yet)\n`;
      }
      
      if (currentState.hasExistingProducts && currentState.suggestedProducts?.length > 0) {
        contextInstructions += `\n**Suggested Products Pool (current session):** ${currentState.suggestedProducts.length} products\n`;
      } else {
        contextInstructions += `**Suggested Products Pool:** EMPTY\n`;
      }
      
      contextInstructions += `\n**⚠️ CRITICAL RULES:**\n`;
      contextInstructions += `1. The above is the ONLY valid source of truth for this quote\n`;
      contextInstructions += `2. DO NOT recall, reference, or reuse ANY products from previous messages/sessions\n`;
      contextInstructions += `3. If user says "add X", add ONLY X (not products from chat history)\n`;
      contextInstructions += `4. If user says "replace Y", remove the specified item and add ONLY what they request\n`;
      contextInstructions += `5. Each message is a FRESH operation on the CURRENT STATE shown above\n`;
      contextInstructions += `6. NEVER merge old suggestions with new - each search is independent\n\n`;
    }
    
    // Enhanced system prompt with context isolation
    const enhancedSystemPrompt = systemPrompt + contextInstructions;
    
    // Build messages array - keep very minimal history (just last exchange) to prevent AI from re-suggesting old products
    const messages: any[] = [
      { role: "system", content: enhancedSystemPrompt },
      ...history.slice(-2).map((msg: any) => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: "user", content: message },
    ];
    
    // Log message construction for debugging
    console.log(`🔒 context:messages { systemPromptLength: ${enhancedSystemPrompt.length}, historyMessages: ${history.slice(-2).length}, currentStateProvided: ${!!currentState} }`);

    // Check abort before expensive OpenAI call
    if (aborted || signal.aborted) {
      console.log('🛑 Aborted before OpenAI call');
      return NextResponse.json({ error: "Request aborted" }, { status: 499 });
    }

    // Initial call with function calling
    let completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.8,
      max_tokens: isComplexRequest ? 1000 : 700,
      presence_penalty: 0.6,
      frequency_penalty: 0.5,
    });
    
    // Check abort after OpenAI call
    if (aborted || signal.aborted) {
      console.log('🛑 Aborted after OpenAI call - NOT saving results');
      return NextResponse.json({ error: "Request aborted" }, { status: 499 });
    }

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

          // Log search for debugging
          console.log('\n🔍 ==================== SEARCH DEBUG ====================');
          console.log('Search keyword:', args.keywords);
          console.log('Search returned', searchResults.length, 'results');
          if (searchResults.length > 0) {
            console.log('Top 10 results with full details:');
            searchResults.slice(0, 10).forEach((p, idx) => {
              console.log(`${idx + 1}. "${p.product_name}" | Brand: ${p.product_brand || 'N/A'} | Type: ${p.product_type || 'N/A'} | Price: $${p.sales_price}`);
            });
          }
          console.log('🔍 ====================================================\n');

          const toolResponse = searchResults.length > 0 
            ? `SUCCESS! Found ${searchResults.length} products matching "${args.keywords}".

TOP RESULTS (in order of relevance):
${formattedResults}

🚨 CRITICAL INSTRUCTIONS:
1. Use the FIRST product from the results above (it's the best match)
2. Copy the EXACT product name and price from the results
3. If the first result has "IO Controller" in name but user asked for "access control", CHECK THE TYPE FIELD
4. DO NOT make up product names - use exactly what's listed above
5. The product you mention in your Work Summary MUST match what you put in PRODUCT_DATA`
            : `No products found matching "${args.keywords}". Try searching with different keywords.`;

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
        temperature: 0.8,
        max_tokens: isComplexRequest ? 1000 : 700,
        presence_penalty: 0.6,
        frequency_penalty: 0.5,
      });

      responseMessage = completion.choices[0].message;
    }

    const aiResponse = responseMessage.content;

    // Parse and extract product data section
    let productSuggestions: any[] = [];
    let cleanMessage = aiResponse || '';
    let requestedItems: RequestedItem[] = [];
    let unfulfilledRequests: UnfulfilledRequest[] = [];
    
    // Check if AI mentioned products but didn't include PRODUCT_DATA (debugging)
    const mentionsProducts = cleanMessage.toLowerCase().includes('added') || 
                            cleanMessage.toLowerCase().includes('found') ||
                            cleanMessage.toLowerCase().includes('included');
    const hasProductData = cleanMessage.includes('PRODUCT_DATA_START');
    
    if (mentionsProducts && !hasProductData) {
      console.warn('⚠️ AI mentioned products but did not include PRODUCT_DATA section');
      console.warn('Response:', cleanMessage);
    }
    
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
    
    // Extract REQUEST_DATA block (user's original requests for validation)
    const requestDataMatch = cleanMessage.match(/REQUEST_DATA_START\n([\s\S]*?)\nREQUEST_DATA_END/);
    if (requestDataMatch) {
      try {
        const json = requestDataMatch[1].trim();
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed)) {
          requestedItems = parsed;
          console.log('📋 Parsed REQUEST_DATA:', requestedItems);
        }
      } catch (error) {
        console.error('❌ Failed to parse REQUEST_DATA JSON:', error);
      }
      // Remove the REQUEST_DATA block from the message
      cleanMessage = cleanMessage.replace(/\n*REQUEST_DATA_START[\s\S]*?REQUEST_DATA_END\n*/g, '').trim();
    }

    // Validate: Check if AI's description matches the actual products suggested
    if (productSuggestions.length > 0) {
      console.log('\n✅ ==================== VALIDATION ====================');
      console.log('AI said in chat:', cleanMessage.substring(0, 300));
      console.log('\nActual products being suggested:');
      productSuggestions.forEach((p, idx) => {
        console.log(`${idx + 1}. ${p.product_name} - $${p.unit_price} each`);
      });
      
      // CRITICAL: Check for potential context reuse
      if (currentState) {
        // Check if any suggested products were already in the current quote
        const existingProductNames = currentState.quotePreview?.line_items?.map((item: any) => 
          item.product_name?.toLowerCase().trim()
        ) || [];
        
        productSuggestions.forEach(p => {
          const productNameLower = p.product_name.toLowerCase().trim();
          if (existingProductNames.includes(productNameLower)) {
            console.warn(`⚠️ attemptedContextReuse: Product "${p.product_name}" already exists in current quote. ContextId: ${contextId}. This may indicate the AI is reusing old context instead of following current instruction.`);
          }
        });
        
        // Check if the number of products seems excessive compared to the user's request
        const userMessageWords: string[] = message.toLowerCase().split(/\s+/);
        const DIGITS = /^\d+$/;
        const hasQuantityInMessage = userMessageWords.some((w: string) => DIGITS.test(w));
        const quantityWord: string | undefined = userMessageWords.find((w: string) => DIGITS.test(w));
        const requestedQuantity = hasQuantityInMessage && quantityWord ? parseInt(quantityWord, 10) : 1;
        
        if (productSuggestions.length > requestedQuantity * 2 && requestedQuantity > 0) {
          console.warn(`⚠️ attemptedContextReuse: AI suggested ${productSuggestions.length} products but user only requested ~${requestedQuantity}. ContextId: ${contextId}. Possible context contamination.`);
        }
      }
      
      // Check for common mismatches
      productSuggestions.forEach(p => {
        if (cleanMessage.toLowerCase().includes('access control') && p.product_name.toLowerCase().includes('io controller') && !p.product_name.toLowerCase().includes('access')) {
          console.error('❌ CRITICAL MISMATCH: AI said "access control" but suggesting "' + p.product_name + '"!');
        }
        if (cleanMessage.toLowerCase().includes('door') && !p.product_name.toLowerCase().includes('door') && !p.product_name.toLowerCase().includes('access')) {
          console.error('❌ MISMATCH: AI said "door" but product name is:', p.product_name);
        }
      });
      console.log('✅ ====================================================\n');
    }

    if (requestedItems.length === 0 && productSuggestions.length > 0) {
      requestedItems = productSuggestions.map((p: any) => ({
        item: p.product_name,
        quantity: p.quantity,
        unit: p.quantity_unit || null,
        budget: p.line_total || null,
        rawText: p.product_name,
        keywords: p.product_name,
      }));
      console.warn('⚠️ REQUEST_DATA block missing. Falling back to PRODUCT_DATA for request mapping.');
    }

    const matchResult = matchRequestsToPriceBook(requestedItems, products);
    const validatedSuggestions = matchResult.suggestions;
    unfulfilledRequests = matchResult.unfulfilled;
    productSuggestions = validatedSuggestions;

    const workSummaryText = buildWorkSummaryText(validatedSuggestions, unfulfilledRequests);
    const cleanedWithoutWorkSummary = stripExistingWorkSummary(cleanMessage);
    const finalMessageParts = [workSummaryText.trim()];
    if (cleanedWithoutWorkSummary) {
      finalMessageParts.push(cleanedWithoutWorkSummary.trim());
    }
    cleanMessage = finalMessageParts.join('\n\n').trim();

    // CRITICAL: Check abort before saving to database
    if (aborted || signal.aborted) {
      console.log('🛑 Aborted before database write - NOT saving products or state');
      return NextResponse.json({ error: "Request aborted" }, { status: 499 });
    }

    // Save products to project_working_state for background task persistence
    if (productSuggestions.length > 0) {
      try {
        // Final abort check before database write
        if (aborted || signal.aborted) {
          console.log('🛑 Aborted right before database write - SKIPPING');
          return NextResponse.json({ error: "Request aborted" }, { status: 499 });
        }

        // Get current working state
        const { data: currentState } = await supabase
          .from("project_working_state")
          .select("*")
          .eq("project_id", projectId)
          .single();

        // CRITICAL: Tag products with poolId for isolation and add canonical keys
        const productsWithPoolAndIds = productSuggestions.map((p: any, idx: number) => ({
          ...p,
          id: `${poolId || Date.now()}-${idx}`,
          poolId: poolId, // Tag with current pool
          selected: false,
          // Canonical key for deduplication
          canonicalKey: p.product_id || p.product_name?.toLowerCase().trim() || `${idx}`
        }));

        // Deduplicate products by canonical key before saving
        const seen = new Set();
        const dedupedProducts = productsWithPoolAndIds.filter((p: any) => {
          if (seen.has(p.canonicalKey)) {
            console.log(`🏊 pool:dedupe { poolId: "${poolId}", dropped: ["${p.product_name}"], reason: "duplicate before save" }`);
            return false;
          }
          seen.add(p.canonicalKey);
          return true;
        });

        // Update or insert working state with new products
        const workingState = {
          project_id: projectId,
          suggested_products: dedupedProducts,
          quote_preview: currentState?.quote_preview || null,
          show_split_view: true,
          current_pool_id: poolId, // Store current poolId for tracking
          unfulfilled_requests: unfulfilledRequests
        };

        const { error: stateError } = await supabase
          .from("project_working_state")
          .upsert(workingState, { onConflict: 'project_id' });

        if (stateError) {
          console.error('Failed to save working state:', stateError);
        } else {
          console.log(`🏊 pool:saved { poolId: "${poolId}", productCount: ${dedupedProducts.length}, projectId: "${projectId}" }`);
        }
      } catch (error) {
        console.error('Error saving products to working state:', error);
      }
    }

    // Clean up abort listener
    signal.removeEventListener('abort', abortHandler);

    console.log(`🏊 pool:complete { poolId: "${poolId || 'none'}", runId: "${runId || 'none'}", productCount: ${productSuggestions.length} }`);

    return NextResponse.json({ 
      message: cleanMessage,
      products: productSuggestions,
      hasProducts: productSuggestions.length > 0,
      unfulfilledRequests,
      runId: runId, // Return runId for validation
      poolId: poolId // Return poolId for pool isolation
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

