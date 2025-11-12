import type { BakedMarkupConfig } from '@/types/database';

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
    targets: Array.isArray(bm.targets) ? bm.targets : [],
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

  // create item map for fast lookup
  const itemMap = new Map(items.map((i: any) => [i.id, i]));
  
  console.log('[rehydrateBakedMarkups] Item map created with keys:', Array.from(itemMap.keys()));
  
  // apply stored markups back to matching items
  let appliedCount = 0;
  for (const bm of bakedMarkups) {
    const perItemDeltas = (bm as any).audited?.perItemDeltas ?? {};
    
    console.log('[rehydrateBakedMarkups] Processing markup:', bm.id, {
      label: bm.label,
      targetCount: (bm.targets || []).length,
      hasPerItemDeltas: Object.keys(perItemDeltas).length > 0
    });
    
    for (const target of bm.targets ?? []) {
      const itemId = (target as any).item_id || (target as any).itemId;
      const item = itemMap.get(itemId);
      
      console.log('[rehydrateBakedMarkups] Processing target:', {
        itemId,
        found: !!item,
        hasAmountCents: !!(target as any).amountCents,
        stableKey: (target as any).stable_key || (target as any).stableKey
      });
      
      if (!item) {
        console.warn('[rehydrateBakedMarkups] Item not found for target:', itemId);
        continue;
      }

      // Try to get amount from target.amountCents (NEW format)
      // Fall back to perItemDeltas[stable_key] (OLD format) if not present
      let amt = 0;
      if ((target as any).amountCents) {
        amt = Number((target as any).amountCents) / 100;
        console.log('[rehydrateBakedMarkups] Using amountCents:', (target as any).amountCents, '→ $' + amt);
      } else {
        // OLD format: lookup by stable_key in perItemDeltas
        const stableKey = (target as any).stable_key || (target as any).stableKey;
        if (stableKey && perItemDeltas[stableKey]) {
          amt = Number(perItemDeltas[stableKey]);
          console.log('[rehydrateBakedMarkups] Using perItemDeltas[' + stableKey + ']:', perItemDeltas[stableKey], '→ $' + amt);
        }
      }
      
      if (amt <= 0) {
        console.warn('[rehydrateBakedMarkups] Amount is zero or negative, skipping');
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

