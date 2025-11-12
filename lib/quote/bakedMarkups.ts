import type { BakedMarkupConfig } from '@/types/database';
import { generateStableKey } from '@/lib/stableKey';

export function normalizeBakedMarkups(quote: any) {
  // Accept camelCase legacy, but write back to snake_case
  if (!Array.isArray(quote.baked_markups)) {
    if (Array.isArray(quote.bakedMarkups)) quote.baked_markups = quote.bakedMarkups;
    else quote.baked_markups = [];
  }
  
  // Ensure correct shape
  quote.baked_markups = (quote.baked_markups as any[]).filter(Boolean).map((bm: any) => ({
    id: String(bm.id ?? cryptoRandomId()),
    label: String(bm.label ?? 'Markup'),
    percent: Number(bm.percent ?? 0),
    baseSelector: bm.baseSelector ?? { include: 'all' },
    addToSelector: bm.addToSelector ?? { include: 'all' },
    distribution: bm.distribution ?? 'proportional',
    rounding: bm.rounding ?? { mode: 'bankers', places: 2 },
    targets: Array.isArray(bm.targets)
      ? bm.targets.filter(Boolean).map((t: any) => ({
          item_id: t.item_id ?? t.itemId ?? undefined,
          itemId: t.itemId ?? t.item_id ?? undefined,
          stable_key: String(t.stable_key ?? t.stableKey ?? ''),
          amountCents: typeof t.amountCents === 'number'
            ? Math.round(t.amountCents)
            : typeof t.amount_cents === 'number'
              ? Math.round(t.amount_cents)
              : undefined
        }))
      : [],
    audited: bm.audited ?? { base: 0, totalMarkup: 0, perItemDeltas: {} },
    createdAt: String(bm.createdAt ?? new Date().toISOString()),
    createdBy: bm.createdBy ?? 'system',
  })) as BakedMarkupConfig[];
}

export function rehydrateBakedMarkupsIntoItems(quote: any) {
  const items = Array.isArray(quote.items) ? quote.items : [];
  const bakedMarkups = Array.isArray(quote.baked_markups) ? quote.baked_markups : [];
  
  console.log('[rehydrateBakedMarkups] START', {
    itemCount: items.length,
    bakedMarkupsCount: bakedMarkups.length,
    itemIds: items.map((i: any) => i.id),
    markupsRaw: JSON.stringify(bakedMarkups, null, 2)
  });
  
  // reset all previous markup flags
  for (const i of items) {
    delete i._uiIncludesMarkup;
    delete i.__includesMarkupCents;
    if (i.bakedAdjustments) {
      i.bakedAdjustments = undefined;
    }
  }

  // create item maps for fast lookup
  const itemMap = new Map<string, any>();
  const productIdMap = new Map<string, any>();
  const stableKeyMap = new Map<string, any[]>();
  
  for (const rawItem of items) {
    const idCandidatesForDirectLookup = [
      rawItem.id,
      rawItem.item_id,
      rawItem.quote_item_id,
      rawItem.product_id,
      (rawItem as any)?.productId
    ].filter(Boolean);

    const canonicalSuggestion = {
      product_name: rawItem.product_name || '',
      description: rawItem.description || '',
      quantity: Number(rawItem.quantity || 0),
      unit_price: Number(rawItem.unit_price || 0),
      line_total: Number(rawItem.line_total || 0),
      selected: true,
      discount_percent: Number(rawItem.discount_percent || 0),
      bakedAdjustments: rawItem.bakedAdjustments
    };

    const stableVariants = new Set<string>();

    // Include any previously persisted keys on the item itself
    if (rawItem.stableKey) stableVariants.add(String(rawItem.stableKey));
    if (rawItem.stable_key) stableVariants.add(String(rawItem.stable_key));

    // Generate variants using different identifier inputs
    const idVariants = new Set<string | undefined>([
      rawItem.id,
      rawItem.item_id,
      rawItem.product_id,
      (rawItem as any)?.productId,
      undefined
    ]);

    for (const candidate of idVariants) {
      const pseudoSuggestion = {
        ...canonicalSuggestion,
        id: candidate || undefined
      };
      const computedKey = generateStableKey(pseudoSuggestion as any);
      stableVariants.add(computedKey);
    }

    rawItem.__stableKeyVariants = Array.from(stableVariants);
    rawItem.__rehydrateIdentity = String(
      rawItem.id ||
      rawItem.item_id ||
      rawItem.product_id ||
      rawItem.__stableKeyVariants?.[0] ||
      cryptoRandomId()
    );

    for (const rawId of idCandidatesForDirectLookup) {
      const key = String(rawId);
      itemMap.set(key, rawItem);
    }

    if (rawItem.product_id) {
      productIdMap.set(String(rawItem.product_id), rawItem);
    }

    for (const key of stableVariants) {
      const existing = stableKeyMap.get(key) || [];
      existing.push(rawItem);
      stableKeyMap.set(key, existing);
    }
  }
  
  console.log('[rehydrateBakedMarkups] Item map created with keys:', Array.from(itemMap.keys()));
  console.log('[rehydrateBakedMarkups] Stable key map created with keys:', Array.from(stableKeyMap.keys()));
  
  // apply stored markups back to matching items
  let appliedCount = 0;
  for (const bm of bakedMarkups) {
    const matchedIdsThisMarkup = new Set<string>();
    const perItemDeltas = (bm as any).audited?.perItemDeltas ?? {};
    const perItemBaseBefore = (bm as any).audited?.perItemBaseBefore ?? {};
    
    console.log('[rehydrateBakedMarkups] Processing markup:', bm.id, {
      label: bm.label,
      targetCount: (bm.targets || []).length,
      hasPerItemDeltas: Object.keys(perItemDeltas).length > 0
    });
    
    for (const target of bm.targets ?? []) {
      const rawId = (target as any).item_id || (target as any).itemId;
      const stableKey = (target as any).stable_key || (target as any).stableKey;
      let item = rawId ? itemMap.get(String(rawId)) || productIdMap.get(String(rawId)) : undefined;

      const matchedKey = item ? String(item.__rehydrateIdentity || item.id || item.product_id || rawId) : null;
      if (item && matchedKey && matchedIdsThisMarkup.has(matchedKey)) {
        item = undefined;
      }
      
      if (!item && stableKey) {
        const candidates = stableKeyMap.get(stableKey) || [];
        if (candidates.length === 1) {
          item = candidates[0];
        } else if (candidates.length > 1) {
          const expectedBaseline = perItemBaseBefore?.[stableKey];
          let bestCandidate: any | undefined;
          let bestScore = Number.MAX_SAFE_INTEGER;
          
          for (const candidate of candidates) {
            const candidateUnique = String(candidate.__rehydrateIdentity || candidate.id || candidate.product_id || candidate.__stableKeyVariants?.[0]);
            if (matchedIdsThisMarkup.has(candidateUnique)) {
              continue;
            }
            if (expectedBaseline !== undefined) {
              const candidateBaseline = Number(candidate.line_total ?? 0);
              const diff = Math.abs(candidateBaseline - expectedBaseline);
              if (diff < bestScore) {
                bestScore = diff;
                bestCandidate = candidate;
              }
            } else {
              bestCandidate = candidate;
              break;
            }
          }

          item = bestCandidate;
        }
      }
      
      if (!item && stableKey && perItemDeltas[stableKey]) {
        const candidates = stableKeyMap.get(stableKey) || [];
        const available = candidates.find(candidate => {
          const candidateUnique = String(candidate.__rehydrateIdentity || candidate.id || candidate.product_id || candidate.__stableKeyVariants?.[0]);
          return !matchedIdsThisMarkup.has(candidateUnique);
        });
        if (available) {
          item = available;
        }
      }

      console.log('[rehydrateBakedMarkups] Processing target:', {
        itemId: rawId,
        stableKey,
        found: !!item,
        hasAmountCents: (target as any).amountCents !== undefined && (target as any).amountCents !== null
      });
      
      if (!item) {
        console.warn('[rehydrateBakedMarkups] Item not found for target:', { rawId, stableKey });
        continue;
      }

      const matchedId = String(item.__rehydrateIdentity || item.id || item.product_id || item.__stableKeyVariants?.[0] || rawId);
      matchedIdsThisMarkup.add(matchedId);

      // Try to get amount from target.amountCents (NEW format)
      // Fall back to perItemDeltas[stable_key] (OLD format) if not present
      let amt = 0;
      if ((target as any).amountCents !== undefined && (target as any).amountCents !== null) {
        amt = Number((target as any).amountCents) / 100;
        console.log('[rehydrateBakedMarkups] Using amountCents:', (target as any).amountCents, '→ $' + amt);
      } else if (stableKey && perItemDeltas[stableKey]) {
        amt = Number(perItemDeltas[stableKey]);
        console.log('[rehydrateBakedMarkups] Using perItemDeltas[' + stableKey + ']:', perItemDeltas[stableKey], '→ $' + amt);
      }
      
      if (!amt || amt <= 0) {
        console.warn('[rehydrateBakedMarkups] Amount is zero or negative, skipping', { rawId, stableKey, amt });
        continue;
      }
      
      item._uiIncludesMarkup = (item._uiIncludesMarkup ?? 0) + amt;
      appliedCount++;
      
      console.log('[rehydrateBakedMarkups] ✓ Applied markup to item:', {
        itemName: item.product_name,
        amount: amt,
        total: item._uiIncludesMarkup
      });
      
      // Also set bakedAdjustments for backward compatibility
      if (!item.bakedAdjustments) {
        item.bakedAdjustments = { markupTotal: 0, breakdown: [] };
      }
      item.bakedAdjustments.markupTotal = (item.bakedAdjustments.markupTotal || 0) + amt;
      item.bakedAdjustments.breakdown = item.bakedAdjustments.breakdown || [];
      item.bakedAdjustments.breakdown.push({
        markupId: bm.id,
        delta: amt
      });
    }
  }
  
  console.log('[rehydrateBakedMarkups] COMPLETE', {
    appliedCount,
    itemsWithMarkup: items.filter((i: any) => i._uiIncludesMarkup > 0).length
  });
  
  // now each item has _uiIncludesMarkup again
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'bm_' + Math.random().toString(36).slice(2);
}

