/**
 * Generate a stable, deterministic key for a line item that survives ID changes.
 * 
 * Used to reliably map discounts and markups back to the same items across versions,
 * even if database IDs change or items are reordered.
 */

import { ProductSuggestion } from '@/types/database';

/**
 * Simple hash function (djb2)
 * Returns a deterministic string hash of the input
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i); // hash * 33 + c
  }
  // Convert to positive hex string
  return (hash >>> 0).toString(36);
}

/**
 * Normalize a product name for stable comparison
 * - Trim whitespace
 * - Lowercase
 * - Remove extra spaces
 */
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Normalize a price to 2 decimal places for stable comparison
 */
function normalizePrice(price: number): string {
  return price.toFixed(2);
}

/**
 * Generate a stable key for a line item
 * 
 * Key components (in order of importance):
 * 1. Product name (normalized)
 * 2. Unit price (normalized to 2 decimals)
 * 3. Product ID/SKU (if available)
 * 4. Description (if available)
 * 
 * Format: hash(name|unitPrice|id|desc)
 * 
 * Example:
 * - "Camera Labor" @ $7500.00 -> "item:abc123xyz"
 * - "CAT6 Cable White" @ $228.00 -> "item:def456abc"
 */
export function generateStableKey(item: ProductSuggestion): string {
  const parts: string[] = [
    normalizeName(item.product_name),
    normalizePrice(item.unit_price)
  ];
  
  // Add product ID if it's a real UUID (not a temp ID)
  if (item.id && !item.id.startsWith('temp-') && !item.id.includes('pool-')) {
    parts.push(item.id);
  }
  
  // Add description if available (helps distinguish variants)
  if (item.description && item.description.trim()) {
    parts.push(normalizeName(item.description.substring(0, 50))); // First 50 chars
  }
  
  const composite = parts.join('|');
  const hash = simpleHash(composite);
  
  return `item:${hash}`;
}

/**
 * Generate stable keys for an array of items
 * Returns a map of item index -> stable key
 */
export function generateStableKeys(items: ProductSuggestion[]): Map<number, string> {
  const map = new Map<number, string>();
  items.forEach((item, idx) => {
    map.set(idx, generateStableKey(item));
  });
  return map;
}

/**
 * Build lookup maps for rehydration
 * 
 * @param items Current items in the quote
 * @returns Lookup maps by ID and stable key
 */
export function buildItemLookups(items: ProductSuggestion[]) {
  const byId = new Map<string, ProductSuggestion>();
  const byKey = new Map<string, ProductSuggestion[]>();
  
  items.forEach(item => {
    // Add to ID map
    if (item.id) {
      byId.set(item.id, item);
    }
    
    // Add to stable key map (allow multiple items with same key)
    const stableKey = generateStableKey(item);
    const existing = byKey.get(stableKey) || [];
    existing.push(item);
    byKey.set(stableKey, existing);
  });
  
  return { byId, byKey };
}

/**
 * Find the best match for a target in the current items
 * 
 * @param target Target from saved markup/discount
 * @param byId Lookup by item ID
 * @param byKey Lookup by stable key
 * @param baselinePrices Baseline prices for disambiguation
 * @param matched Set of already matched item IDs
 * @returns Matched item or null
 */
export function findBestMatch(
  target: { item_id?: string; stable_key: string },
  byId: Map<string, ProductSuggestion>,
  byKey: Map<string, ProductSuggestion[]>,
  baselinePrices: Record<string, number>,
  matched: Set<string>
): ProductSuggestion | null {
  // Strategy 1: Try ID match first
  if (target.item_id && byId.has(target.item_id)) {
    const item = byId.get(target.item_id)!;
    if (!matched.has(item.id || '')) {
      return item;
    }
  }
  
  // Strategy 2: Try stable key match
  const candidates = byKey.get(target.stable_key);
  if (!candidates || candidates.length === 0) {
    return null;
  }
  
  // Filter out already matched items
  const available = candidates.filter(c => !matched.has(c.id || ''));
  if (available.length === 0) {
    return null;
  }
  
  // If multiple candidates, pick the one with unit_price closest to baseline
  if (available.length === 1) {
    return available[0];
  }
  
  const expectedPrice = baselinePrices[target.stable_key];
  if (expectedPrice !== undefined) {
    // Find closest match by unit price
    let best = available[0];
    let bestDiff = Math.abs(available[0].unit_price - expectedPrice);
    
    for (let i = 1; i < available.length; i++) {
      const diff = Math.abs(available[i].unit_price - expectedPrice);
      if (diff < bestDiff) {
        best = available[i];
        bestDiff = diff;
      }
    }
    
    return best;
  }
  
  // Fallback: return first available
  return available[0];
}

