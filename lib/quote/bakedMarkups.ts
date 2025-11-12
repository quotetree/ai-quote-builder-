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
  
  // Clear old hints
  items.forEach((it: any) => {
    delete it.__includesMarkupCents;
    if (it.bakedAdjustments) {
      it.bakedAdjustments = undefined;
    }
  });

  const map = new Map(items.map((i: any) => [i.id, i]));
  
  for (const bm of quote.baked_markups ?? []) {
    const targets = bm.targets ?? [];
    const perItemDeltas = bm.audited?.perItemDeltas ?? {};
    
    for (const t of targets) {
      const itemId = (t as any).item_id || (t as any).itemId;
      const stableKey = (t as any).stable_key || (t as any).stableKey;
      
      // Amount is in perItemDeltas keyed by stable_key
      const amount = perItemDeltas[stableKey] || 0;
      
      if (amount <= 0) continue;
      
      const it = map.get(itemId);
      if (!it) continue;
      
      // Accumulate (multiple markups can affect same item)
      it.__includesMarkupCents = (it.__includesMarkupCents ?? 0) + (amount * 100);
      
      // Also set bakedAdjustments for UI
      if (!it.bakedAdjustments) {
        it.bakedAdjustments = { markupTotal: 0, breakdown: [] };
      }
      it.bakedAdjustments.markupTotal = (it.bakedAdjustments.markupTotal || 0) + amount;
      it.bakedAdjustments.breakdown = it.bakedAdjustments.breakdown || [];
      it.bakedAdjustments.breakdown.push({
        markupId: bm.id,
        delta: amount
      });
    }
  }
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'bm_' + Math.random().toString(36).slice(2);
}

