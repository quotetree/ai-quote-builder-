import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentChunkMetadata } from "@/types/database";
import {
  retrieveDocumentChunks,
  type DocumentCitation,
  type RetrievedChunkContext,
} from "@/lib/ai/retrieveDocumentChunks";
import { ensureChunkMetadata } from "@/lib/ai/rfp/chunkMetadata";
import {
  pageSpanKey,
  scoreChunkForProfile,
  type ScorableChunk,
} from "@/lib/ai/rfp/chunkScoring";
import {
  classifyRfpIntents,
  resolveRfpAnalysisMode,
  type RfpIntent,
} from "@/lib/ai/rfp/rfpIntentClassifier";
import {
  buildRetrievalProfiles,
  RETRIEVAL_PROFILE_ORDER,
  RETRIEVAL_SECTION_TITLES,
  type RetrievalProfileKey,
} from "@/lib/ai/rfp/rfpQueryExpansion";
import {
  DEFAULT_MAX_CHUNKS,
  MAX_CHUNKS_PER_PAGE_SPAN,
  PER_PASS_LIMIT,
  RFP_MAX_CHUNKS,
  RFP_MAX_CONTEXT_TOKENS,
} from "@/lib/ai/rfp/rfpRetrievalConfig";
import {
  logRfpRetrievalDebug,
  type RfpRetrievalDebugPayload,
} from "@/lib/ai/rfp/rfpRetrievalDebug";
import { loadHybridCandidates } from "@/lib/ai/retrieval/hybridRetrieval";
import { loadStructuredExtractions } from "@/lib/ai/loadStructuredExtractions";

export interface RfpIntelligenceResult extends RetrievedChunkContext {
  isRfpAnalysisMode: boolean;
  intents: RfpIntent[];
}

interface ScoredEntry {
  chunk: ScorableChunk;
  score: number;
  reasons: string[];
  profile: RetrievalProfileKey;
}

function formatPageRange(start: number, end: number): string {
  return start === end ? `page ${start}` : `pages ${start}–${end}`;
}

function intentMetadataBoost(intent: RfpIntent, meta: DocumentChunkMetadata): number {
  switch (intent) {
    case "locations":
      return meta.contains_locations ? 3 : 0;
    case "quantities":
    case "equipment_inventory":
      return (meta.contains_quantities || meta.has_table) ? 3 : 0;
    case "materials":
      return meta.contains_materials ? 3 : 0;
    case "scope_of_work":
      return meta.contains_scope_language ? 3 : 0;
    case "labor_requirements":
    case "maintenance_requirements":
      return meta.contains_labor_requirements ? 3 : 0;
    case "quote_requirements":
    case "certifications_compliance":
      return meta.contains_trade_terms ? 2 : 0;
    default:
      return 0;
  }
}

function diversifyAndTrim(
  entries: ScoredEntry[],
  maxChunks: number,
  maxTokens: number,
): ScoredEntry[] {
  const spanCounts = new Map<string, number>();
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const selected: ScoredEntry[] = [];
  let tokenSum = 0;

  for (const entry of sorted) {
    if (selected.length >= maxChunks) break;
    const span = pageSpanKey(entry.chunk);
    const count = spanCounts.get(span) ?? 0;
    if (count >= MAX_CHUNKS_PER_PAGE_SPAN) continue;

    const tokens = entry.chunk.token_count ?? Math.ceil(entry.chunk.chunk_text.length / 4);
    if (tokenSum + tokens > maxTokens && selected.length >= DEFAULT_MAX_CHUNKS) continue;

    selected.push(entry);
    spanCounts.set(span, count + 1);
    tokenSum += tokens;
  }

  if (selected.length === 0 && sorted.length > 0) {
    return sorted.slice(0, Math.min(maxChunks, DEFAULT_MAX_CHUNKS));
  }

  return selected;
}

function buildStructuredPrompt(
  byProfile: Map<RetrievalProfileKey, ScoredEntry[]>,
  fileNamesByDocId: Record<string, string>,
): { promptText: string; citations: DocumentCitation[] } {
  const citations: DocumentCitation[] = [];
  const sections: string[] = [];

  for (const profile of RETRIEVAL_PROFILE_ORDER) {
    const entries = byProfile.get(profile) ?? [];
    if (entries.length === 0) continue;

    const blocks = entries.map(({ chunk }) => {
      const fileName = fileNamesByDocId[chunk.document_id] ?? "Document";
      citations.push({
        documentId: chunk.document_id,
        fileName,
        pageStart: chunk.page_start,
        pageEnd: chunk.page_end,
      });
      return `### ${fileName} (${formatPageRange(chunk.page_start, chunk.page_end)})\n${chunk.chunk_text}`;
    });

    sections.push(`${RETRIEVAL_SECTION_TITLES[profile]}\n\n${blocks.join("\n\n---\n\n")}`);
  }

  return {
    promptText: sections.join("\n\n\n"),
    citations,
  };
}

export async function retrieveRfpIntelligence(
  supabase: SupabaseClient,
  projectId: string,
  documentIds: string[],
  userMessage: string,
  fileNamesByDocId: Record<string, string>,
  options: {
    pageCounts?: number[];
    hasChunkedPdf?: boolean;
  } = {},
): Promise<RfpIntelligenceResult> {
  if (documentIds.length === 0) {
    return {
      promptText: "",
      citations: [],
      isRfpAnalysisMode: false,
      intents: [],
    };
  }

  const fileNames = documentIds.map((id) => fileNamesByDocId[id] ?? "");
  const classification = resolveRfpAnalysisMode(userMessage, {
    hasChunkedPdf: options.hasChunkedPdf ?? true,
    fileNames,
    pageCounts: options.pageCounts ?? [],
  });

  if (!classification.isRfpAnalysisMode) {
    const basic = await retrieveDocumentChunks(
      supabase,
      projectId,
      documentIds,
      userMessage,
      fileNamesByDocId,
    );
    return {
      ...basic,
      isRfpAnalysisMode: false,
      intents: classification.intents,
    };
  }

  const hybridCandidates = await loadHybridCandidates(
    supabase,
    projectId,
    documentIds,
    userMessage,
    fileNamesByDocId,
  );

  if (hybridCandidates.length === 0) {
    const basic = await retrieveDocumentChunks(
      supabase,
      projectId,
      documentIds,
      userMessage,
      fileNamesByDocId,
    );
    return {
      ...basic,
      isRfpAnalysisMode: true,
      intents: classification.intents,
    };
  }

  const rows = hybridCandidates.map((row) => ({
    ...row,
    chunk_metadata: ensureChunkMetadata(row.chunk_metadata, row.chunk_text),
  })) as ScorableChunk[];

  const profiles = buildRetrievalProfiles(userMessage, classification.intents);
  const passResults: ScoredEntry[] = [];
  const scoringReasons: Record<string, string[]> = {};

  for (const profile of RETRIEVAL_PROFILE_ORDER) {
    const terms = profiles[profile];
    const scored = rows
      .map((chunk) => {
        const { score, reasons } = scoreChunkForProfile(
          chunk,
          fileNamesByDocId[chunk.document_id] ?? "",
          terms,
          profile,
        );
        let total = score;
        for (const intent of classification.intents) {
          total += intentMetadataBoost(intent, chunk.chunk_metadata);
        }
        return { chunk, score: total, reasons, profile };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.chunk_index - b.chunk.chunk_index)
      .slice(0, PER_PASS_LIMIT);

    if (scored.length === 0) {
      const fallback = [...rows]
        .sort((a, b) => a.chunk_index - b.chunk_index)
        .slice(0, 3)
        .map((chunk) => ({
          chunk,
          score: 1,
          reasons: ["fallback:spread"],
          profile,
        }));
      passResults.push(...fallback);
      continue;
    }

    for (const s of scored) {
      scoringReasons[s.chunk.id] = s.reasons;
    }
    passResults.push(...scored);
  }

  const merged = new Map<string, ScoredEntry>();
  for (const entry of passResults) {
    const existing = merged.get(entry.chunk.id);
    if (!existing || entry.score > existing.score) {
      merged.set(entry.chunk.id, entry);
    }
  }

  const trimmed = diversifyAndTrim(
    Array.from(merged.values()),
    RFP_MAX_CHUNKS,
    RFP_MAX_CONTEXT_TOKENS,
  );

  const byProfile = new Map<RetrievalProfileKey, ScoredEntry[]>();
  for (const entry of trimmed) {
    const list = byProfile.get(entry.profile) ?? [];
    list.push(entry);
    byProfile.set(entry.profile, list);
  }

  const { promptText: chunkPrompt, citations } = buildStructuredPrompt(
    byProfile,
    fileNamesByDocId,
  );

  const structuredBlock = await loadStructuredExtractions(
    supabase,
    projectId,
    documentIds,
    fileNamesByDocId,
    { intents: classification.intents },
  );

  const promptText = [structuredBlock, chunkPrompt].filter(Boolean).join("\n\n");

  const totalTokens = trimmed.reduce(
    (sum, e) => sum + (e.chunk.token_count ?? Math.ceil(e.chunk.chunk_text.length / 4)),
    0,
  );
  const tableChunksIncluded = trimmed.filter((e) => e.chunk.chunk_metadata.has_table).length;

  const debugPayload: RfpRetrievalDebugPayload = {
    intents: classification.intents,
    isRfpAnalysisMode: true,
    expandedQueries: profiles,
    retrievedChunkIds: trimmed.map((e) => e.chunk.id),
    pageRanges: trimmed.map((e) => ({
      chunkId: e.chunk.id,
      fileName: fileNamesByDocId[e.chunk.document_id] ?? "Document",
      pageStart: e.chunk.page_start,
      pageEnd: e.chunk.page_end,
    })),
    scoringReasons,
    tableChunksIncluded,
    totalTokens,
    chunkCount: trimmed.length,
  };
  logRfpRetrievalDebug(debugPayload);

  return {
    promptText: promptText
      ? `## RFP Document Analysis Context\n\nUse all sections below. Cross-reference schedules, scope, and location sections before concluding information is missing.\n\n${promptText}`
      : "",
    citations,
    isRfpAnalysisMode: true,
    intents: classification.intents,
  };
}
