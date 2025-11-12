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
  const items = quote.items || [];
  const bakedMarkups = quote.baked_markups || [];
  
  // Clear previous markup flags
  for (const i of items) {
    delete i.__includesMarkupCents;
    if (i.bakedAdjustments) {
      i.bakedAdjustments = undefined;
    }
  }

  const itemById = new Map(items.map((i: any) => [i.id, i]));
  
  for (const bm of bakedMarkups) {
    const perItemDeltas = bm.audited?.perItemDeltas ?? {};
    
    for (const t of bm.targets ?? []) {
      const itemId = (t as any).item_id || (t as any).itemId;
      const stableKey = (t as any).stable_key || (t as any).stableKey;
      
      // Get amount from perItemDeltas using stable_key
      const amountCents = (perItemDeltas[stableKey] || 0) * 100;
      if (amountCents <= 0) continue;
      
      const item = itemById.get(itemId);
      if (!item) continue;
      
      // Accumulate cents (multiple markups can affect same item)
      item.__includesMarkupCents = (item.__includesMarkupCents ?? 0) + amountCents;
      
      // Also set bakedAdjustments for UI (in dollars)
      const amountDollars = amountCents / 100;
      if (!item.bakedAdjustments) {
        item.bakedAdjustments = { markupTotal: 0, breakdown: [] };
      }
      item.bakedAdjustments.markupTotal = (item.bakedAdjustments.markupTotal || 0) + amountDollars;
      item.bakedAdjustments.breakdown = item.bakedAdjustments.breakdown || [];
      item.bakedAdjustments.breakdown.push({
        markupId: bm.id,
        delta: amountDollars
      });
    }
  }
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'bm_' + Math.random().toString(36).slice(2);
}

