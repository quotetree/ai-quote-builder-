import type { DocumentChunkMetadata } from "@/types/database";

export interface ScorableChunkRow {
  id: string;
  document_id: string;
  page_start: number;
  page_end: number;
  chunk_index: number;
  chunk_text: string;
  token_count: number | null;
  chunk_metadata?: DocumentChunkMetadata | null;
}

export function tokenizeQuery(message: string): string[] {
  return message
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 2);
}

export function keywordScore(
  chunk: ScorableChunkRow,
  fileName: string,
  queryTerms: string[],
): number {
  if (queryTerms.length === 0) return 0;
  const hay = `${fileName}\n${chunk.chunk_text}`.toLowerCase();
  const hits = queryTerms.filter((term) => hay.includes(term)).length;
  return hits / queryTerms.length;
}

export function normalizeScores(scores: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const v of scores.values()) max = Math.max(max, v);
  if (max <= 0) return scores;
  const out = new Map<string, number>();
  for (const [k, v] of scores) out.set(k, v / max);
  return out;
}

export function metadataScore(meta: DocumentChunkMetadata | null | undefined): number {
  if (!meta) return 0;
  let score = 0;
  if (meta.has_table) score += 0.3;
  if (meta.contains_quantities) score += 0.25;
  if (meta.contains_locations) score += 0.15;
  if (meta.contains_materials) score += 0.15;
  if (meta.contains_scope_language) score += 0.15;
  return Math.min(score, 1);
}
