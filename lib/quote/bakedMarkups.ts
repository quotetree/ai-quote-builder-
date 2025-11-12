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
  
  // apply stored markups back to matching items
  for (const bm of bakedMarkups) {
    for (const target of bm.targets ?? []) {
      const itemId = (target as any).item_id || (target as any).itemId;
      const item = itemMap.get(itemId);
      if (!item) continue;

      const amt = Number((target as any).amountCents ?? 0) / 100;
      if (amt <= 0) continue;
      
      item._uiIncludesMarkup = (item._uiIncludesMarkup ?? 0) + amt;
      
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
  
  // now each item has _uiIncludesMarkup again
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'bm_' + Math.random().toString(36).slice(2);
}

