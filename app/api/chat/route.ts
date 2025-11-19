import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Common stopwords to filter out when extracting keywords from user requests
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
  'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'will',
  'with', 'i', 'need', 'want', 'also', 'some', 'get', 'can', 'we', 'my', 'me'
]);

/**
 * Builds a searchable text string from a product's text fields.
 * This is used for generic keyword-based matching across the price book.
 */
function buildSearchText(product: any): string {
  return [
    product.product_name,
    product.product_number,    // Product Code
    product.product_brand,
    product.product_type,
    product.product_family_name, // Product Family name (if joined)
    product.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[-_]/g, ' ')  // Normalize hyphens and underscores
    .replace(/\s+/g, ' ')   // Normalize whitespace
    .trim();
}

/**
 * Extracts meaningful keywords from a user's request text.
 * Filters out stopwords and keeps only substantive terms.
 */
function extractKeywords(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Replace punctuation with spaces
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(word => word.length > 1 && !STOPWORDS.has(word));
}

/**
 * Scores products based on generic keyword matching across all product fields.
 * This is industry-agnostic and works for any business based on their price book data.
 * 
 * Example:
 * - "4 Verkada bullet cameras" with no products containing both "verkada" AND "bullet" → low/zero scores
 * - "6 boxes of CAT6 cable" with product name "CAT6 Riser Cable" → high score
 */
function searchProductsWithScores(products: any[], keywords: string): { product: any; score: number }[] {
  if (!keywords || keywords.trim() === '') {
    return products.slice(0, 20).map(product => ({ product, score: 0 }));
  }
  
  // Extract keywords from user's search query
  const searchKeywords = extractKeywords(keywords);
  
  if (searchKeywords.length === 0) {
    return products.slice(0, 20).map(product => ({ product, score: 0 }));
  }
  
  console.log('🔍 Search keywords:', searchKeywords);
  console.log('🏷️  Product types in database:', [...new Set(products.map(p => p.product_type).filter(Boolean))].slice(0, 10));
  
  const scored = products.map(product => {
    let score = 0;
    
    // Build searchable text from all product fields
    const searchText = buildSearchText(product);
    const productName = (product.product_name || '').toLowerCase().replace(/[-_]/g, ' ');
    const productBrand = (product.product_brand || '').toLowerCase().replace(/[-_]/g, ' ');
    const productType = (product.product_type || '').toLowerCase().replace(/[-_]/g, ' ');
    const productCode = (product.product_number || '').toLowerCase().replace(/[-_]/g, ' ');
    
    // Count how many keywords match
    let keywordsMatched = 0;
    let keywordsInName = 0;
    let keywordsInBrand = 0;
    let keywordsInType = 0;
    let exactCodeMatch = false;
    
    searchKeywords.forEach(keyword => {
      if (searchText.includes(keyword)) {
        keywordsMatched++;
        score += 10; // Base score for any match in searchable text
      }
      
      // Boost for matches in specific fields
      if (productName.includes(keyword)) {
        keywordsInName++;
        score += 25; // Higher weight for name matches
      }
      
      if (productBrand.includes(keyword)) {
        keywordsInBrand++;
        score += 30; // Even higher for brand matches (important for specificity)
      }
      
      if (productType.includes(keyword)) {
        keywordsInType++;
        score += 20; // Type matches are important
      }
      
      // Exact product code match is very important
      if (productCode && productCode === keyword) {
        exactCodeMatch = true;
        score += 200;
      }
    });
    
    // Bonus: All keywords found in searchable text (strong match)
    if (keywordsMatched === searchKeywords.length) {
      score += 100;
    }
    
    // Bonus: All keywords in product name (very specific match)
    if (keywordsInName === searchKeywords.length && searchKeywords.length > 1) {
      score += 150;
    }
    
    // Penalty: Missing keywords (progressively worse)
    const missingKeywords = searchKeywords.length - keywordsMatched;
    if (missingKeywords > 0) {
      score -= missingKeywords * 50; // Heavy penalty for missing keywords
    }
    
    // Check for compound phrases (multi-word matches in sequence)
    if (searchKeywords.length >= 2) {
      for (let i = 0; i < searchKeywords.length - 1; i++) {
        const phrase = `${searchKeywords[i]} ${searchKeywords[i + 1]}`;
        if (searchText.includes(phrase)) {
          score += 40; // Bonus for maintaining word order
        }
      }
    }
    
    return { product, score };
  });
  
  const sorted = scored.sort((a, b) => b.score - a.score);
  
  // Only return products with positive scores (at least some keyword matches)
  const results = sorted.filter(item => item.score > 0).slice(0, 20);
  
  console.log(`📦 Found ${results.length} products with positive scores. Top 5:`, results.slice(0, 5).map(item => ({
    name: item.product.product_name,
    type: item.product.product_type,
    brand: item.product.product_brand,
    score: item.score
  })));
  
  // If no positive scores, return empty (will trigger "not found" message)
  if (results.length === 0) {
    console.log('❌ No products with positive keyword match scores. Returning empty.');
    return [];
  }
  
  return results;
}

function searchProducts(products: any[], keywords: string): any[] {
  return searchProductsWithScores(products, keywords).map(item => item.product);
}

// ============================================================================
// ENHANCED TYPES FOR CONVERSATIONAL AI
// ============================================================================

/**
 * Enhanced RequestedItem with fields for natural language understanding.
 * This allows the LLM to capture nuanced details like duration, modifiers, corrections.
 */
interface EnhancedRequestedItem {
  rawText: string;              // Original user phrase
  item: string;                 // Cleaned item name
  brand?: string;               // e.g., "Verkada", "Acme"
  productType?: string;         // e.g., "camera", "license", "cable"
  productFamily?: string;       // e.g., "Security", "Networking"
  duration?: string;            // e.g., "1-year", "5-year", "10-year"
  subtype?: string;             // e.g., "dome", "bullet", "mini dome"
  quantity?: number;            // How many
  unit?: string | null;         // e.g., "ea", "boxes", "rolls"
  budget?: number | null;       // Dollar amount if specified
  modifiers?: string[];         // e.g., ["not 5-year", "outdoor version", "cheapest"]
  keywords?: string;            // Combined search string for price book
  action?: 'add' | 'replace' | 'remove'; // What to do with this item
  replaces?: string;            // If action='replace', what item it replaces
}

/**
 * Conversation state for tracking context across messages.
 * Enables ChatGPT-like intelligence: "add 5 more", "not the 5-year", "replace those with".
 */
interface ConversationState {
  lastRequestedItems: EnhancedRequestedItem[];  // What was in the previous message
  accumulatedItems: EnhancedRequestedItem[];    // Running list of all items discussed
  lastUserMessage: string;                      // For reference
}

// Legacy interface for backward compatibility with existing code
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

// ============================================================================
// CONVERSATIONAL AI FUNCTIONS
// ============================================================================

/**
 * Uses LLM to extract structured items from natural language.
 * Understands corrections, negations, and context.
 * 
 * Examples:
 * - "I need the 1-year license, not the 5-year" → duration: "1-year", modifiers: ["not 5-year"]
 * - "Replace domes with mini domes" → action: "replace", replaces: "domes"
 * - "Add 5 more solar units" → quantity: 5, productType: "solar units"
 */
async function extractRequestedItems(
  message: string,
  conversationState: ConversationState,
  openai: OpenAI
): Promise<EnhancedRequestedItem[]> {
  const extractionPrompt = `You are an expert at parsing natural language requests for products and services.

**Your task:** Extract structured item requests from the user's message.

**User's message:** "${message}"

**Previous context:**
${conversationState.lastRequestedItems.length > 0 
  ? `Last items discussed: ${conversationState.lastRequestedItems.map(i => `${i.quantity || 1}x ${i.item}${i.duration ? ` (${i.duration})` : ''}`).join(', ')}`
  : 'No previous items'
}

**CRITICAL INSTRUCTIONS FOR DURATION:**

Duration is a **STRICT, NON-SUBSTITUTABLE CONSTRAINT**. Pay extreme attention:

1. **Normalize duration formats:**
   - "1 year", "1-year", "one year" → "1-year"
   - "5 year", "5-year", "five year" → "5-year"
   - "10 year", "10-year", "ten year" → "10-year"

2. **Duration in corrections:**
   - "I need the **1 year** license, **not the 5 year**" 
     → Extract: duration="1-year", action="replace", replaces="5-year license"
   - This is a CORRECTION, not two separate requests!
   - Only extract the CORRECTED duration (1-year), not both

3. **Multiple items with different durations:**
   - "5 environmental sensors and (5) 1 year verkada camera license"
     → Extract TWO items:
     1. sensors (no duration)
     2. license (duration="1-year", quantity=5)

**Instructions:**
1. Identify ALL product/service requests in the message
2. Extract these fields for each item:
   - rawText: the exact phrase from user
   - item: cleaned product name
   - brand: if mentioned (e.g., "Verkada", "Acme")
   - productType: general category (e.g., "camera", "license", "cable")
   - **duration: REQUIRED if time-based** (e.g., "1-year", "5-year", "10-year") - USE NORMALIZED FORMAT
   - subtype: specific variant (e.g., "dome", "bullet", "mini dome", "outdoor")
   - quantity: number requested
   - unit: if specified (e.g., "ea", "boxes", "rolls")
   - budget: dollar amount if given
   - modifiers: array of constraints like ["not 5-year", "outdoor version", "cheapest"]
   - action: "add" (default), "replace", or "remove"
   - replaces: if replacing/correcting, what duration/item is being replaced

3. **Handle corrections and negations:**
   - "not the 5-year" → This is a CORRECTION: action="replace", replaces="5-year license", ONLY extract the wanted duration
   - "instead of X" → action="replace", replaces="X"
   - "replace X with Y" → action="replace", replaces="X"

4. **Understand references:**
   - "5 more of those" → refer to previous items
   - "the solar units we talked about" → refer to context

**EXAMPLES:**

Example 1:
Input: "Give me (5) 1 year verkada camera license"
Output:
[
  {
    "rawText": "(5) 1 year verkada camera license",
    "item": "verkada camera license",
    "brand": "Verkada",
    "productType": "license",
    "duration": "1-year",
    "quantity": 5,
    "action": "add"
  }
]

Example 2:
Input: "i need 5 environmental sensors and (5) 1 year verkada camera license"
Output:
[
  {
    "rawText": "5 environmental sensors",
    "item": "environmental sensors",
    "quantity": 5,
    "action": "add"
  },
  {
    "rawText": "(5) 1 year verkada camera license",
    "item": "verkada camera license",
    "brand": "Verkada",
    "productType": "license",
    "duration": "1-year",
    "quantity": 5,
    "action": "add"
  }
]

Example 3:
Input: "I need the 1 year verkada camera license not the 5"
Output:
[
  {
    "rawText": "1 year verkada camera license not the 5",
    "item": "verkada camera license",
    "brand": "Verkada",
    "productType": "license",
    "duration": "1-year",
    "quantity": 1,
    "action": "replace",
    "replaces": "5-year license"
  }
]

**CRITICAL RULES FOR DURATION:**
- "1 year", "1-year", "one year", "1 yr" → ALWAYS extract as duration: "1-year"
- "5 year", "5-year", "five year", "5 yr" → ALWAYS extract as duration: "5-year"
- "10 year", "10-year", "ten year", "10 yr" → ALWAYS extract as duration: "10-year"
- Do NOT drop duration when parsing quantities like "(5) 1 year"
- Duration is MANDATORY for license/subscription products

**CRITICAL:** Return ONLY the JSON array, no other text.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a JSON extraction expert. Output only valid JSON." },
        { role: "user", content: extractionPrompt }
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const responseText = completion.choices[0].message.content?.trim() || '[]';
    
    // Remove markdown code fences if present
    const jsonText = responseText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    
    const extracted = JSON.parse(jsonText) as EnhancedRequestedItem[];
    
    console.log('🧠 LLM extracted items:', extracted);
    
    return extracted;
  } catch (error) {
    console.error('❌ Failed to extract items via LLM:', error);
    // Fallback: basic extraction
    return [{
      rawText: message,
      item: message,
      quantity: 1,
      action: 'add'
    }];
  }
}

/**
 * Updates conversation state with new items, handling corrections and replacements.
 * Enables "replace the domes with mini domes" type intelligence.
 * 
 * CRITICAL: Handles duration corrections properly:
 * - "not the 5-year" removes 5-year items
 * - Only keeps items with correct duration
 */
function updateConversationState(
  extractedItems: EnhancedRequestedItem[],
  currentState: ConversationState,
  userMessage: string
): ConversationState {
  let accumulated = [...currentState.accumulatedItems];
  
  extractedItems.forEach(item => {
    if (item.action === 'remove') {
      // Remove items matching this description
      accumulated = accumulated.filter(existing => 
        !existing.item.toLowerCase().includes(item.item.toLowerCase())
      );
      console.log(`🗑️  Removed items matching: ${item.item}`);
      
    } else if (item.action === 'replace') {
      // Handle replacement - this includes duration corrections
      
      // If replaces contains duration info (e.g., "5-year license")
      if (item.replaces) {
        const replacesLower = item.replaces.toLowerCase();
        
        // Remove items that match the "replaces" description
        accumulated = accumulated.filter(existing => {
          const existingDesc = `${existing.duration || ''} ${existing.item}`.toLowerCase();
          const matches = existingDesc.includes(replacesLower) || 
                         existing.item.toLowerCase().includes(replacesLower);
          
          if (matches) {
            console.log(`🔄 Removing old item: ${existing.duration || ''} ${existing.item} (replaced by ${item.duration || ''} ${item.item})`);
            return false;
          }
          return true;
        });
      }
      
      // Also remove items with same productType but DIFFERENT duration
      if (item.duration && item.productType) {
        accumulated = accumulated.filter(existing => {
          // Same type but different duration = needs replacement
          const sameType = existing.productType?.toLowerCase() === item.productType?.toLowerCase() ||
                          existing.item.toLowerCase().includes(item.productType.toLowerCase());
          const differentDuration = existing.duration && existing.duration !== item.duration;
          
          if (sameType && differentDuration) {
            console.log(`🔄 Removing conflicting duration: ${existing.duration} ${existing.item} (replaced by ${item.duration} ${item.item})`);
            return false;
          }
          return true;
        });
      }
      
      // Add the new item
      accumulated.push(item);
      console.log(`✅ Replaced with: ${item.quantity || 1}x ${item.duration || ''} ${item.item}`);
      
    } else {
      // Default: add item
      accumulated.push(item);
      console.log(`➕ Added: ${item.quantity || 1}x ${item.duration || ''} ${item.item}`);
    }
  });
  
  return {
    lastRequestedItems: extractedItems,
    accumulatedItems: accumulated,
    lastUserMessage: userMessage,
  };
}

/**
 * Converts EnhancedRequestedItem to keywords string for price book search.
 * Combines all relevant fields into a searchable string.
 */
function buildSearchKeywordsFromItem(item: EnhancedRequestedItem): string {
  const parts = [
    item.brand,
    item.duration,
    item.productType,
    item.subtype,
    item.item,
  ].filter(Boolean);
  
  return parts.join(' ');
}

/**
 * Normalizes duration string for flexible matching.
 * "1-year", "1 year", "1year" all become ["1", "year", "1 year", "1-year"]
 */
function normalizeDuration(duration: string): string[] {
  if (!duration) return [];
  
  const lower = duration.toLowerCase().trim();
  const variants: string[] = [lower]; // Original
  
  // Extract number and "year"
  const match = lower.match(/(\d+)[\s-]*(year|yr)/);
  if (match) {
    const num = match[1];
    variants.push(`${num} year`);
    variants.push(`${num}-year`);
    variants.push(`${num}year`);
    variants.push(`${num} yr`);
    variants.push(`${num}-yr`);
  }
  
  return variants;
}

/**
 * Checks if a product satisfies hard constraints (especially duration).
 * Returns true if all hard constraints are met, false otherwise.
 * 
 * Hard constraints:
 * - duration: If specified, product MUST contain the duration in searchable text
 */
function meetsHardConstraints(product: any, item: EnhancedRequestedItem, verbose: boolean = false): boolean {
  const searchText = buildSearchText(product);
  
  // CRITICAL: Duration is a hard constraint
  if (item.duration) {
    const durationVariants = normalizeDuration(item.duration);
    const hasDuration = durationVariants.some(variant => searchText.includes(variant));
    
    if (verbose || !hasDuration) {
      console.log(`   ${hasDuration ? '✓' : '✗'} Product: "${product.product_name}"`);
      console.log(`      Duration required: ${item.duration}`);
      console.log(`      Variants checked: [${durationVariants.join(', ')}]`);
      console.log(`      SearchText: "${searchText.substring(0, 150)}${searchText.length > 150 ? '...' : ''}"`);
      console.log(`      Result: ${hasDuration ? 'PASS' : 'FAIL'}`);
    }
    
    if (!hasDuration) {
      return false;
    }
  }
  
  // Future: Add other hard constraints here (exact model codes, etc.)
  
  return true;
}

/**
 * Minimum score required to consider a product match valid.
 * If best match score is below this, treat as "not found".
 * 
 * Score guide:
 * - 100+ = All keywords matched across fields (good match)
 * - 50-99 = Partial keyword matches (questionable)
 * - <50 = Weak match, likely wrong product
 */
const MATCH_CONFIDENCE_THRESHOLD = 50;

/**
 * HYBRID SEARCH ENGINE MODEL (Option B)
 * 
 * Maximum number of products to show per requested item when matches are ambiguous.
 * Examples:
 * - "misc material" → shows up to 4 misc-related SKUs
 * - "outdoor cameras" → shows up to 4 outdoor camera models
 */
const MAX_PER_ITEM = 4;

/**
 * Score difference threshold to determine if a match is "precise" vs "ambiguous".
 * 
 * If the top match's score is >= CLEAR_WINNER_DELTA higher than the second match,
 * we treat it as a precise request and return only that single product.
 * 
 * Otherwise, we treat it as ambiguous and return multiple matches (up to MAX_PER_ITEM).
 * 
 * Examples:
 * - Top score: 520, Second: 480 → Delta 40 → Single precise match
 * - Top score: 520, Second: 510 → Delta 10 → Ambiguous, show multiple
 */
const CLEAR_WINNER_DELTA = 30;

/**
 * Decides whether to return a single "precise" match or multiple "ambiguous" matches.
 * 
 * Decision logic:
 * 1. If only 1 match exists → return it (precise)
 * 2. If top match's score is CLEAR_WINNER_DELTA higher than second → return only top match (precise)
 * 3. Otherwise → return up to MAX_PER_ITEM matches (ambiguous, like a search engine)
 * 
 * @param exactMatches - Products that passed hard constraints, sorted by score descending
 * @returns Selected products to show user (1 for precise, N for ambiguous)
 */
function selectExactMatchesForItem(exactMatches: any[]): any[] {
  if (exactMatches.length === 0) return [];
  
  // Case 1: Only one match → precise, return it
  if (exactMatches.length === 1) {
    console.log(`      → Precise: single match found`);
    return [exactMatches[0]];
  }
  
  // Case 2: Multiple matches - check score gap between top 2
  const [first, second] = exactMatches;
  const scoreDelta = first.score - second.score;
  
  console.log(`      → Score gap between top 2: ${scoreDelta} (threshold: ${CLEAR_WINNER_DELTA})`);
  
  // If the top result is clearly better → treat as precise, single result
  if (scoreDelta >= CLEAR_WINNER_DELTA) {
    console.log(`      → Precise: clear winner (score gap ${scoreDelta} >= ${CLEAR_WINNER_DELTA})`);
    return [first];
  }
  
  // Otherwise, ambiguous → return up to MAX_PER_ITEM matches
  const selected = exactMatches.slice(0, MAX_PER_ITEM);
  console.log(`      → Ambiguous: returning ${selected.length} matches (max ${MAX_PER_ITEM})`);
  return selected;
}

/**
 * Enhanced matching with hard constraint enforcement.
 * Accepts EnhancedRequestedItem[] and enforces duration constraints.
 * 
 * NEW (Option B): Returns multiple products per item when matches are ambiguous,
 * like a search engine. This applies from the FIRST message onwards.
 * 
 * THREE-TIER SCORING SYSTEM:
 * - Score ≥ 50: Auto-add to "Suggested Products"
 * - Score 1-49: Show as "possible matches" in chat (user can manually add)
 * - Score 0: Don't show (completely unrelated)
 */
function matchEnhancedRequestsToPriceBook(
  requestedItems: EnhancedRequestedItem[], 
  products: any[]
): { suggestions: any[]; lowConfidenceMatches: any[]; unfulfilled: UnfulfilledRequest[] } {
  const suggestionsMap = new Map<string, any>();
  const lowConfidenceMap = new Map<string, any>();
  const unfulfilled: UnfulfilledRequest[] = [];

  if (!requestedItems || requestedItems.length === 0) {
    return { suggestions: [], lowConfidenceMatches: [], unfulfilled };
  }

  requestedItems.forEach((request) => {
    const keywords = buildSearchKeywordsFromItem(request);
    
    if (!keywords || keywords.trim() === '') {
      unfulfilled.push({
        requestedText: request.item || request.rawText || 'Unknown item',
        reason: 'No recognizable keywords were provided for matching',
      });
      return;
    }

    console.log(`\n🔍 Matching item: ${request.item}${request.duration ? ` (${request.duration})` : ''}`);
    console.log(`   Keywords: ${keywords}`);
    console.log(`   Duration constraint: ${request.duration || 'none'}`);

    const results = searchProductsWithScores(products, keywords);
    
    // DEBUG: Show top candidate products BEFORE hard constraints
    console.log(`\n   📊 Top 5 candidates BEFORE hard constraints:`);
    results.slice(0, 5).forEach((r, idx) => {
      const searchText = buildSearchText(r.product);
      console.log(`      ${idx + 1}. "${r.product.product_name}" (score: ${r.score})`);
      console.log(`         SearchText: ${searchText.substring(0, 120)}...`);
    });
    
    // CRITICAL: Filter results by hard constraints (especially duration)
    if (request.duration) {
      const durationVariants = normalizeDuration(request.duration);
      console.log(`\n   🔒 Applying duration constraint: ${durationVariants.join(', ')}`);
    }
    
    const validResults = results.filter(result => {
      const passes = meetsHardConstraints(result.product, request);
      if (!passes && results.indexOf(result) < 3) {
        // Log why top 3 failed
        console.log(`      ❌ "${result.product.product_name}" failed hard constraints`);
      }
      return passes;
    });
    
    console.log(`\n   ✅ Result: ${results.length} keyword matches → ${validResults.length} after hard constraints`);
    
    // THREE-TIER SCORING SYSTEM:
    // 1. Score >= 50: High confidence, auto-add to Suggested Products
    // 2. Score 1-49: Low confidence, show as possible matches (user can manually add)
    // 3. Score 0: No relevance, don't show
    
    // Step 1: Filter high-confidence results
    const highConfidenceResults = validResults.filter(r => r.score >= MATCH_CONFIDENCE_THRESHOLD);
    
    // Step 2: Build a Set of high-confidence product IDs to prevent duplicates
    const highConfidenceIds = new Set(
      highConfidenceResults.map(r => r.product.id || r.product.product_name?.toLowerCase().trim())
    );
    
    // Step 3: Filter low-confidence results, EXCLUDING any that are already in high-confidence
    const lowConfidenceResultsRaw = validResults.filter(r => r.score > 0 && r.score < MATCH_CONFIDENCE_THRESHOLD);
    const lowConfidenceResults = lowConfidenceResultsRaw.filter(r => {
      const productId = r.product.id || r.product.product_name?.toLowerCase().trim();
      return !highConfidenceIds.has(productId);
    });
    
    console.log(`   📊 Score breakdown: ${highConfidenceResults.length} high-confidence (≥50), ${lowConfidenceResultsRaw.length} raw low-confidence, ${lowConfidenceResults.length} deduped low-confidence (1-49)`);
    
    // Process high-confidence matches (auto-add)
    const selectedMatches = selectExactMatchesForItem(highConfidenceResults);

    if (selectedMatches.length > 0) {
      // Add ALL selected matches to suggestions (auto-add to quote)
      console.log(`   ✅ Auto-adding ${selectedMatches.length} high-confidence product(s):`);
      
      selectedMatches.forEach((matchResult, idx) => {
        const product = matchResult.product;
        const matchScore = matchResult.score;
        
        console.log(`      ${idx + 1}. "${product.product_name}" (score: ${matchScore})`);
        
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
            match_confidence: matchScore,
            matched_requests: [request.item || keywords],
          });
        }
      });
    }
    
    // Process low-confidence matches (show but don't auto-add)
    if (lowConfidenceResults.length > 0) {
      console.log(`   💡 Showing ${lowConfidenceResults.length} low-confidence match(es) as suggestions:`);
      
      const selectedLowConfidence = lowConfidenceResults.slice(0, MAX_PER_ITEM);
      
      selectedLowConfidence.forEach((matchResult, idx) => {
        const product = matchResult.product;
        const matchScore = matchResult.score;
        
        console.log(`      ${idx + 1}. "${product.product_name}" (score: ${matchScore})`);
        
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

        if (!lowConfidenceMap.has(key)) {
          lowConfidenceMap.set(key, {
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
            match_confidence: matchScore,
            matched_requests: [request.item || keywords],
            requested_item: request.item || keywords, // Track what user asked for
          });
        }
      });
    }
    
    // If no matches at all (not even low confidence), add to unfulfilled
    if (selectedMatches.length === 0 && lowConfidenceResults.length === 0) {
      // No exact match found - build detailed error message with close matches
      let reason = '';
      const closeMatches: string[] = [];
      
      if (request.duration) {
        // Duration constraint not met - show close matches WITHOUT the duration requirement
        reason = `No products in your price book contain "${request.duration}" for this item.`;
        
        // Show top N products that match keywords but not duration (alternatives only)
        const topWithoutDuration = results.slice(0, MAX_PER_ITEM);
        if (topWithoutDuration.length > 0) {
          reason += `\n\nClosest matches (without "${request.duration}"):\n`;
          topWithoutDuration.forEach((r, idx) => {
            const matchInfo = `${idx + 1}. ${r.product.product_name}`;
            closeMatches.push(matchInfo);
            reason += `  • ${matchInfo}\n`;
          });
          reason += '\nThese products were NOT added because they don\'t have the required duration.';
        }
      } else {
        // General keyword mismatch - show top N by keyword score (alternatives only)
        const requestKeywords = extractKeywords(keywords);
        const keywordList = requestKeywords.length > 0 ? requestKeywords.join(', ') : 'these terms';
        
        if (results.length > 0) {
          const topN = results.slice(0, MAX_PER_ITEM);
          reason = `No products in your price book closely match this request. Closest matches:\n`;
          topN.forEach((r, idx) => {
            const matchInfo = `${idx + 1}. ${r.product.product_name}`;
            closeMatches.push(matchInfo);
            reason += `  • ${matchInfo}\n`;
          });
          reason += `\nSearched for keywords: ${keywordList}`;
        } else {
          reason = `No products in your price book contain these keywords: ${keywordList}`;
        }
      }
      
      console.log(`   ❌ Not matched: ${reason.split('\n')[0]}`);
      if (closeMatches.length > 0) {
        console.log(`   📋 Close matches shown: ${closeMatches.length}`);
      }
      
      unfulfilled.push({
        requestedText: `${request.duration ? request.duration + ' ' : ''}${request.item}`,
        reason,
      });
    }
  });

  const suggestions = Array.from(suggestionsMap.values());
  const lowConfidenceMatches = Array.from(lowConfidenceMap.values());
  
  console.log(`\n🎯 Final results: ${suggestions.length} auto-added, ${lowConfidenceMatches.length} suggested, ${unfulfilled.length} unfulfilled`);
  
  return { suggestions, lowConfidenceMatches, unfulfilled };
}

/**
 * Legacy matching function - kept for backward compatibility.
 * New code should use matchEnhancedRequestsToPriceBook instead.
 */
function matchRequestsToPriceBook(requestedItems: RequestedItem[], products: any[]) {
  // Convert to enhanced items
  const enhancedItems: EnhancedRequestedItem[] = requestedItems.map(item => ({
    rawText: item.rawText || item.item,
    item: item.item,
    quantity: item.quantity,
    unit: item.unit,
    budget: item.budget,
    keywords: item.keywords,
    action: 'add'
  }));
  
  return matchEnhancedRequestsToPriceBook(enhancedItems, products);
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

    // ============================================================================
    // PHASE 1: LLM-POWERED INTENT EXTRACTION (Conversational Intelligence)
    // ============================================================================
    
    // Initialize conversation state from history or create new
    let conversationState: ConversationState = {
      lastRequestedItems: [],
      accumulatedItems: [],
      lastUserMessage: '',
    };
    
    // Try to load state from current session if available
    if (currentState?.conversationState) {
      conversationState = currentState.conversationState;
      console.log('📖 Loaded conversation state from session:', {
        lastItems: conversationState.lastRequestedItems.length,
        accumulated: conversationState.accumulatedItems.length
      });
    }
    
    // Extract structured items from user's natural language
    console.log('🧠 Phase 1: Extracting structured items from user message...');
    console.log(`   User message: "${message}"`);
    const extractedItems = await extractRequestedItems(message, conversationState, openai);
    console.log('✅ Extracted items:', extractedItems.map(i => `${i.quantity || 1}x ${i.item} (${i.duration || 'no duration'})`));
    console.log('📋 DEBUG: Full extracted items:', JSON.stringify(extractedItems, null, 2));
    
    // Update conversation state with new items (handles corrections, replacements)
    conversationState = updateConversationState(extractedItems, conversationState, message);
    console.log('📝 Updated conversation state:', {
      newItems: extractedItems.length,
      totalAccumulated: conversationState.accumulatedItems.length
    });
    
    // ============================================================================
    // PHASE 2: STRICT PRICE BOOK MATCHING (Zero Hallucination)
    // ============================================================================
    
    console.log('🔍 Phase 2: Matching against price book with strict hard constraints...');
    console.log(`   Items to match (from CURRENT message only): ${extractedItems.length}`);
    extractedItems.forEach((item, idx) => {
      console.log(`   ${idx + 1}. ${item.quantity || 1}x ${item.duration ? item.duration + ' ' : ''}${item.item} (action: ${item.action || 'add'})`);
    });
    
    // CRITICAL: Only match items from CURRENT message (extractedItems)
    // Do NOT match accumulatedItems - that would introduce unrelated products
    const { suggestions, lowConfidenceMatches, unfulfilled } = matchEnhancedRequestsToPriceBook(extractedItems, products);
    
    console.log('✅ Matching results:', {
      autoAdded: suggestions.length,
      suggested: lowConfidenceMatches.length,
      unfulfilled: unfulfilled.length
    });
    
    if (suggestions.length > 0) {
      console.log('   Auto-added products (score ≥ 50):');
      suggestions.forEach((s, idx) => {
        console.log(`   ${idx + 1}. ${s.product_name} - Qty: ${s.quantity}, Price: $${s.unit_price}`);
      });
    }
    
    if (lowConfidenceMatches.length > 0) {
      console.log('   Low-confidence suggestions (score 1-49):');
      lowConfidenceMatches.forEach((s, idx) => {
        console.log(`   ${idx + 1}. ${s.product_name} - Score: ${s.match_confidence}`);
      });
    }
    
    if (unfulfilled.length > 0) {
      console.log('   Unfulfilled requests (score 0):');
      unfulfilled.forEach((u, idx) => {
        console.log(`   ${idx + 1}. ${u.requestedText} - ${u.reason}`);
      });
    }
    
    // CRITICAL: Store Phase 2 results to use after AI response generation
    // These will be used to validate/override AI's product suggestions
    const phase2MatchedProducts = suggestions;
    const phase2LowConfidenceMatches = lowConfidenceMatches;
    const phase2UnfulfilledRequests = unfulfilled;
    
    console.log('💾 Stored Phase 2 results for post-AI validation');

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
## 🤖 TWO-PHASE INTELLIGENCE SYSTEM:

**Phase 1 (ALREADY DONE):** Natural language extraction with conversational intelligence
- ✅ Your extraction engine has ALREADY parsed the user's message
- ✅ It understood corrections like "not the 5-year", "instead of", "replace with"
- ✅ It tracked conversation context and references to previous items
- ✅ It extracted structured data: brand, duration, product type, modifiers

**Phase 2 (ALREADY DONE):** Strict price book matching with zero hallucination
- ✅ Extracted items were matched against the price book using field-based keyword search
- ✅ Products found: ${suggestions.length} items
- ✅ Products not found: ${unfulfilled.length} items
- ✅ NO substitutions were made - only exact keyword matches returned

**YOUR ROLE:**
You are now in the **presentation layer**. Your job is to:
1. Present the results conversationally in the Work Summary
2. List successfully matched products in PRODUCT_DATA section
3. List unfulfilled requests in "Couldn't Add" section
4. Ask clarifying questions or suggest next steps

**DO NOT:**
- Re-extract items (already done)
- Re-search the price book (already done)
- Second-guess the matching results
- Suggest products that weren't found

**The hard work is done. Just present the results professionally.**

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
  { "item": "Acme widgets", "quantity": 4, "unit": "units", "budget": null, "rawText": "4 Acme widgets", "keywords": "acme widget" },
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
Current message: "I need one premium widget from Acme"
Your PRODUCT_DATA section: ONLY that 1 widget (not 5 products from history)

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
- User: "Acme brand sprinkler heads" → search_price_book("acme sprinkler heads")
- User: "5-year software license" → search_price_book("5 year software license")
- User: "TPO roofing membrane" → search_price_book("tpo roofing membrane")
- User: "8 boxes of cat6 cable" → search_price_book("cat6 cable")

**CRITICAL:** When user specifies a brand or specific product details, ALWAYS include them in your search!
- ❌ BAD: User says "Acme brand widget" → You search "widget" (missing brand!)
- ✅ GOOD: User says "Acme brand widget" → You search "acme widget"

**CRITICAL - PRODUCT FIELDS:** The search looks across product name, code, brand, type, family AND description fields!

Examples of how this works:
- Product: "Premium Widget" (name) + "WID-100" (code) + "Hardware" (type) + "Acme" (brand)
- User searches: "Acme hardware widget" → PERFECT MATCH!
- User searches: "WID-100" → PERFECT MATCH (exact code match!)
- User searches: "premium widget" → PERFECT MATCH (name match!)

Include ALL the keywords the user provides in your search - the system will find matches across all product fields!

**CRITICAL: Selecting Products from Search Results**

**IMPORTANT:** If your search returns products, YOU MUST SUGGEST THEM. Do NOT say "not found" when the search returns results!

When you search and get results back:
1. **The search results are VALID products** - they were found in the price book
2. **Look at the product names in the results** - if any match what the user asked for, USE IT
3. **Be flexible with word order** - "5-Year Intercom License" matches "5-year intercom license" request
4. **DO NOT reject good matches** - if it has the key terms (intercom, camera, etc.), it's a match!

**Examples:**
- User: "5-year software license" 
- Search finds: "Premium 5-Year Software License" at $1,749
- ✅ **CORRECT:** Add this to PRODUCT_DATA section immediately!
- ❌ **WRONG:** Saying "not found" when it's right there!

- User: "roofing membrane"
- Search finds: "TPO Membrane Roll" ($599), "EPDM Membrane Roll" ($749), "PVC Membrane Roll" ($899)
- ✅ **CORRECT:** Suggest the first match OR ask which type they prefer
- ❌ **WRONG:** Saying "not found" or "no exact match"

**GOLDEN RULE: If search returns products with matching keywords → USE THE FIRST GOOD MATCH!**
**Don't overthink it. Don't say "not found". Just use the product from the search results!**

**🚨 CRITICAL: NEVER SUBSTITUTE PRODUCTS - KEYWORD MATCHING REQUIRED**

Product matching is based on **keywords in the user's request matching keywords in your price book**:

**STRICT RULES:**
1. Products are matched by searching across: Product Name, Product Code, Product Brand, Product Type, Product Family, and Description
2. If user asks for **specific keywords** (e.g., "bullet camera", "TPO membrane", "sprinkler head") and search returns NO results → Report "❌ Could not add [item] (not found in price book)"
3. **NEVER suggest products that don't match the user's keywords**
4. **NEVER substitute one product for another just because they're "similar"**
5. If search returns empty results, the item should be reported as "Could not add" in the Work Summary

**Examples of CORRECT behavior:**
- User: "4 Acme Model X widgets"
- Search: Returns no products containing both "acme" AND "model x"
- ✅ **CORRECT:** Report "❌ Could not add Acme Model X widgets (no matching products in price book)"
- ❌ **WRONG:** Suggesting a different widget model

- User: "1 commercial grade compressor"
- Search: Returns no results
- ✅ **CORRECT:** Report "❌ Could not add commercial grade compressor (no matching products in price book)"
- ❌ **WRONG:** Ignoring the request completely

- User: "10 bags of mulch"
- Search: Returns "Premium Hardwood Mulch Bag"
- ✅ **CORRECT:** Suggest the mulch product (matches "mulch" and "bag")
- ❌ **WRONG:** Saying "not found" when it matches the keywords

**The matching is data-driven:**
- Your price book determines what products exist
- Matching is based on keywords the user provides
- If keywords don't match any product fields → report as unfulfilled
- If keywords DO match → suggest the product

**If the user specifies keywords and you can't find matching products → TELL THEM. Never substitute or ignore.**

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
1. Premium Widget License - Qty: 1, Price: $999.00 each = $999.00
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
✓ "16 hours of installation labor" → Search for installation labor, use 16 × hourly_rate
✓ "project management labor at $3,000" → Search for project management labor, use Qty: 1 at $3,000
✓ "put design work at 4000" → Search for design work, use Qty: 1 at $4,000
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
  * "I see we have both Brand X and Brand Y widgets in stock. Do you have a preference?"
  * "For the materials, do you need standard grade or premium grade? What's the application?"
  * "I notice this is for a commercial space - do we need any specific certifications or ratings?"

### Phase 3: Product Recommendations
- Once you have enough context, search for products and add them to PRODUCT_DATA section
- In your chat response, keep it simple:
  * "Based on what you described, I've added some products to the Suggested Products panel for your review"
  * Don't list product names or prices in the chat
  * If you need to ask about alternatives, ask generally: "For these products, do you prefer budget or premium options?"
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
1. Premium Widget License - Qty: 1, Price: $999.00 each = $999.00
2. Premium Cable Spool - Qty: 1, Price: $225.00 each = $225.00
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
❌ Search returns "Premium 5-Year Widget License" → You say "not found" (WRONG!)
❌ Search returns results → You reject them because word order is different (WRONG!)
❌ User asks for 1 product → You include 5 products from conversation history (WRONG!)

**CORRECT BEHAVIOR:**
✅ Search returns products → Suggest the best match from results
✅ "5-Year Widget License" matches request for "5-year widget license" (word order doesn't matter)
✅ User asks for 1 product → Include ONLY that 1 product from CURRENT message

**If the search found products, USE THEM. Don't overthink it!**`;


    // Define tools for function calling
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "search_price_book",
          description: "Search the price book for products using keywords. Searches across Product Name, Product Code, Product Brand, Product Type, Product Family, and Description fields. Always use this before recommending products.",
          parameters: {
            type: "object",
            properties: {
              keywords: {
                type: "string",
                description: "Keywords to search for (e.g., 'widget', 'acme sprinkler head', 'TPO membrane', 'installation labor')"
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
    
    // Add Phase 1 & 2 results
    contextInstructions += `\n## 📊 EXTRACTED ITEMS & MATCHING RESULTS:\n\n`;
    contextInstructions += `**Extracted from user message (Phase 1):**\n`;
    extractedItems.forEach((item, idx) => {
      contextInstructions += `${idx + 1}. ${item.quantity || 1}x ${item.item}`;
      if (item.brand) contextInstructions += ` (Brand: ${item.brand})`;
      if (item.duration) contextInstructions += ` (Duration: ${item.duration})`;
      if (item.modifiers && item.modifiers.length > 0) contextInstructions += ` [Modifiers: ${item.modifiers.join(', ')}]`;
      contextInstructions += `\n`;
    });
    
    contextInstructions += `\n**Matched Products (Phase 2):**\n`;
    if (suggestions.length > 0) {
      suggestions.forEach((prod, idx) => {
        contextInstructions += `${idx + 1}. ${prod.product_name} - Qty: ${prod.quantity}, Unit Price: $${prod.unit_price}, Total: $${prod.line_total}\n`;
      });
    } else {
      contextInstructions += `None - no products matched\n`;
    }
    
    contextInstructions += `\n**Unfulfilled Requests (Phase 2):**\n`;
    if (unfulfilled.length > 0) {
      unfulfilled.forEach((unf, idx) => {
        contextInstructions += `${idx + 1}. ${unf.requestedText} - ${unf.reason}\n`;
      });
    } else {
      contextInstructions += `None - all items matched\n`;
    }
    contextInstructions += `\n`;
    
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
3. Check ALL product fields (Name, Code, Brand, Type, Description) for keyword matches
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
      
      // Log product suggestions for debugging
      productSuggestions.forEach((p, idx) => {
        console.log(`  ${idx + 1}. Suggesting: "${p.product_name}" (Score: ${p.match_confidence || 'N/A'})`);
      });
      console.log('✅ ====================================================\n');
    }

    // ============================================================================
    // USE PHASE 2 RESULTS (Already matched with hard constraints)
    // ============================================================================
    
    console.log('🔄 Using Phase 2 matching results (strict constraint enforcement)');
    console.log(`   Phase 2 auto-added: ${phase2MatchedProducts.length} products`);
    console.log(`   Phase 2 low-confidence: ${phase2LowConfidenceMatches.length} suggestions`);
    console.log(`   Phase 2 unfulfilled: ${phase2UnfulfilledRequests.length} requests`);
    
    // CRITICAL: Use Phase 2 results directly - they already have hard constraint enforcement
    // DO NOT re-match or use AI's PRODUCT_DATA suggestions
    productSuggestions = phase2MatchedProducts;
    unfulfilledRequests = phase2UnfulfilledRequests;

    // Build low-confidence suggestions section (scores 1-49)
    let lowConfidenceSuggestionsText = '';
    if (phase2LowConfidenceMatches.length > 0) {
      lowConfidenceSuggestionsText = '\n\n**💡 Possible Matches (Not Auto-Added):**\n\n';
      lowConfidenceSuggestionsText += 'We didn\'t find a confident exact match, but here are some products you might mean:\n\n';
      
      phase2LowConfidenceMatches.forEach((product, idx) => {
        lowConfidenceSuggestionsText += `${idx + 1}. **${product.product_name}**`;
        if (product.product_brand) {
          lowConfidenceSuggestionsText += ` (${product.product_brand})`;
        }
        lowConfidenceSuggestionsText += ` - $${product.unit_price} each\n`;
        lowConfidenceSuggestionsText += `   *For: "${product.requested_item}"*\n`;
        lowConfidenceSuggestionsText += `   → Use the **"+ Add to Quote"** button to add this item if it's correct.\n\n`;
      });
      
      lowConfidenceSuggestionsText += '*These items were not automatically added because the match confidence was low. Please review and add manually if appropriate.*';
    }

    const workSummaryText = buildWorkSummaryText(productSuggestions, unfulfilledRequests);
    const cleanedWithoutWorkSummary = stripExistingWorkSummary(cleanMessage);
    const finalMessageParts = [workSummaryText.trim()];
    if (lowConfidenceSuggestionsText) {
      finalMessageParts.push(lowConfidenceSuggestionsText.trim());
    }
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

        // Update or insert working state with new products AND conversation state
        const workingState = {
          project_id: projectId,
          suggested_products: dedupedProducts,
          quote_preview: currentState?.quote_preview || null,
          show_split_view: true,
          current_pool_id: poolId, // Store current poolId for tracking
          unfulfilled_requests: unfulfilledRequests,
          conversation_state: conversationState // Save conversation state for context tracking
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

