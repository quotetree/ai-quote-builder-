import type { DocumentChunkMetadata } from "@/types/database";

const METADATA_VERSION = 1;

const TABLE_HEADER_RE =
  /\b(qty|quantity|unit|item|description|clin|part\s*#|model|location|count|total)\b/i;
const LOCATION_RE =
  /\b(facility|facilities|building|buildings|floor|room|site|sites|campus|address|wing|area|areas)\b/i;
const MATERIAL_RE =
  /\b(bom|bill of materials|material list|equipment list|panel schedule|riser|one-line|device schedule|inventory)\b/i;
const SCOPE_RE =
  /\b(shall|contractor shall|scope of work|deliverable|provide|install|replace|furnish)\b/i;
const LABOR_RE =
  /\b(labor|man[- ]?hour|fte|service|maintenance|warranty|repair|preventive)\b/i;
const TRADE_RE =
  /\b(pws|clin|specification|commissioning|testing|alternate|base bid|addendum|compliance)\b/i;
const QUANTITY_RE = /\b(\d{1,5}|each|total|quantity|qty)\b/g;

export function analyzeChunkMetadata(chunkText: string): DocumentChunkMetadata {
  const text = chunkText.toLowerCase();
  const lines = chunkText.split(/\n/).filter((l) => l.trim().length > 0);
  const tabLines = lines.filter((l) => l.includes("\t")).length;
  const numericDenseLines = lines.filter((l) => (l.match(/\d/g) ?? []).length >= 4).length;

  const hasTable =
    tabLines >= 2 ||
    (numericDenseLines >= 3 && lines.length >= 4) ||
    TABLE_HEADER_RE.test(chunkText);

  const quantityMatches = chunkText.match(QUANTITY_RE);
  const contains_quantities =
    (quantityMatches?.length ?? 0) >= 8 || /\bqty\b|\bquantity\b|\btotal\b/i.test(chunkText);

  return {
    has_table: hasTable,
    contains_quantities,
    contains_locations: LOCATION_RE.test(text),
    contains_materials: MATERIAL_RE.test(text),
    contains_scope_language: SCOPE_RE.test(text),
    contains_labor_requirements: LABOR_RE.test(text),
    contains_trade_terms: TRADE_RE.test(text),
    metadata_version: METADATA_VERSION,
  };
}

export function ensureChunkMetadata(
  stored: DocumentChunkMetadata | null | undefined,
  chunkText: string,
): DocumentChunkMetadata {
  if (stored && Object.keys(stored).length > 0 && stored.metadata_version) {
    return stored;
  }
  return analyzeChunkMetadata(chunkText);
}
