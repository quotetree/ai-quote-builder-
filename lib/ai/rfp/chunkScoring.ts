import type { DocumentChunkMetadata } from "@/types/database";
import type { RetrievalProfileKey } from "@/lib/ai/rfp/rfpQueryExpansion";

export interface ScorableChunk {
  id: string;
  document_id: string;
  page_start: number;
  page_end: number;
  chunk_index: number;
  chunk_text: string;
  token_count: number | null;
  chunk_metadata: DocumentChunkMetadata;
}

const PROFILE_METADATA_BOOST: Record<
  RetrievalProfileKey,
  (keyof DocumentChunkMetadata)[]
> = {
  locations: ["contains_locations"],
  schedules: ["has_table", "contains_quantities", "contains_materials"],
  scope: ["contains_scope_language", "contains_trade_terms"],
  quote: ["contains_trade_terms", "contains_scope_language"],
  labor: ["contains_labor_requirements"],
  exclusions: ["contains_trade_terms", "contains_scope_language"],
};

const PROFILE_REGEX_BOOSTS: Record<RetrievalProfileKey, RegExp[]> = {
  locations: [/\bfacility\b/i, /\bbuilding\b/i, /\bsite\b/i, /\bcampus\b/i],
  schedules: [
    /\bqty\b/i,
    /\bquantity\b/i,
    /\bclin\b/i,
    /\bpanel schedule\b/i,
    /\binventory\b/i,
    /\b\d+\s+\d+\s+\d+/,
  ],
  scope: [/\bshall\b/i, /\bcontractor shall\b/i, /\bscope\b/i, /\bpws\b/i],
  quote: [/\bclin\b/i, /\bbase bid\b/i, /\bproposal\b/i, /\bprice\b/i],
  labor: [/\blabor\b/i, /\bservice\b/i, /\bmaintenance\b/i, /\bwarranty\b/i],
  exclusions: [/\balternate\b/i, /\baddendum\b/i, /\bexclude\b/i, /\bassumption\b/i],
};

export interface ChunkScoreResult {
  score: number;
  reasons: string[];
}

export function scoreChunkForProfile(
  chunk: ScorableChunk,
  fileName: string,
  terms: string[],
  profile: RetrievalProfileKey,
): ChunkScoreResult {
  const hay = `${fileName}\n${chunk.chunk_text}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  for (const term of terms) {
    if (term.length > 2 && hay.includes(term)) {
      score += 1;
      if (reasons.length < 5) reasons.push(`term:${term}`);
    }
  }

  const meta = chunk.chunk_metadata;
  for (const key of PROFILE_METADATA_BOOST[profile]) {
    if (meta[key]) {
      score += 4;
      reasons.push(`meta:${key}`);
    }
  }

  for (const re of PROFILE_REGEX_BOOSTS[profile]) {
    if (re.test(chunk.chunk_text)) {
      score += 3;
      reasons.push(`regex:${re.source.slice(0, 24)}`);
    }
  }

  if (profile === "schedules" && meta.has_table) {
    score += 5;
    reasons.push("boost:table");
  }

  if (/\bshall\b/i.test(chunk.chunk_text)) {
    score += 2;
    reasons.push("boost:shall");
  }

  if (/\b(pws|clin)\b/i.test(chunk.chunk_text)) {
    score += 2;
    reasons.push("boost:trade_terms");
  }

  const digitCount = (chunk.chunk_text.match(/\d/g) ?? []).length;
  if (digitCount >= 15 && (profile === "schedules" || profile === "quote")) {
    score += 2;
    reasons.push("boost:numbers");
  }

  return { score, reasons };
}

export function pageSpanKey(chunk: ScorableChunk): string {
  return `${chunk.document_id}:${chunk.page_start}-${chunk.page_end}`;
}
