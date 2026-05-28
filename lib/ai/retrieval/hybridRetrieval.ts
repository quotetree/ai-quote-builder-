import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentChunkMetadata } from "@/types/database";
import {
  hybridWeights,
  isHybridRetrievalEnabled,
  semanticMatchCount,
} from "@/lib/ai/documentProcessingConfig";
import { embedQuery } from "@/lib/ai/embeddings/embedQuery";
import {
  keywordScore,
  metadataScore,
  normalizeScores,
  tokenizeQuery,
  type ScorableChunkRow,
} from "@/lib/ai/retrieval/scoringUtils";

export interface HybridChunkCandidate extends ScorableChunkRow {
  hybridScore: number;
  semanticScore: number;
  keywordScoreVal: number;
  metadataScoreVal: number;
}

interface SemanticMatchRow {
  id: string;
  document_id: string;
  page_start: number;
  page_end: number;
  chunk_index: number;
  chunk_text: string;
  token_count: number | null;
  chunk_metadata: DocumentChunkMetadata | null;
  similarity: number;
}

/**
 * Load candidate chunks via pgvector + score with hybrid formula.
 * Falls back to loading all chunks when embeddings unavailable.
 */
export async function loadHybridCandidates(
  supabase: SupabaseClient,
  projectId: string,
  documentIds: string[],
  userMessage: string,
  fileNamesByDocId: Record<string, string>,
  options?: { loadAllFallback?: boolean },
): Promise<HybridChunkCandidate[]> {
  if (documentIds.length === 0) return [];

  const queryTerms = tokenizeQuery(userMessage);
  const weights = hybridWeights();
  const useHybrid = isHybridRetrievalEnabled();
  const queryEmbedding = useHybrid ? await embedQuery(userMessage) : null;

  let rows: ScorableChunkRow[] = [];
  const semanticScores = new Map<string, number>();

  if (queryEmbedding) {
    const { data: matches, error } = await supabase.rpc("match_document_chunks", {
      query_embedding: queryEmbedding,
      match_project_id: projectId,
      match_document_ids: documentIds,
      match_count: semanticMatchCount(),
      match_threshold: parseFloat(process.env.SEMANTIC_MATCH_THRESHOLD ?? "0.25"),
    });

    if (!error && matches?.length) {
      for (const m of matches as SemanticMatchRow[]) {
        semanticScores.set(m.id, m.similarity);
        rows.push({
          id: m.id,
          document_id: m.document_id,
          page_start: m.page_start,
          page_end: m.page_end,
          chunk_index: m.chunk_index,
          chunk_text: m.chunk_text,
          token_count: m.token_count,
          chunk_metadata: m.chunk_metadata,
        });
      }
    }
  }

  if (rows.length === 0 && (options?.loadAllFallback !== false || !queryEmbedding)) {
    const { data: allChunks } = await supabase
      .from("document_chunks")
      .select(
        "id, document_id, page_start, page_end, chunk_index, chunk_text, token_count, chunk_metadata",
      )
      .eq("project_id", projectId)
      .in("document_id", documentIds)
      .order("chunk_index", { ascending: true });

    rows = (allChunks ?? []) as ScorableChunkRow[];
  }

  const normSemantic = normalizeScores(semanticScores);
  const keywordScores = new Map<string, number>();
  const metaScores = new Map<string, number>();

  for (const row of rows) {
    keywordScores.set(
      row.id,
      keywordScore(row, fileNamesByDocId[row.document_id] ?? "", queryTerms),
    );
    metaScores.set(row.id, metadataScore(row.chunk_metadata));
  }

  const normKeyword = normalizeScores(keywordScores);
  const normMeta = normalizeScores(metaScores);

  return rows.map((row) => {
    const semanticScore = normSemantic.get(row.id) ?? 0;
    const keywordScoreVal = normKeyword.get(row.id) ?? 0;
    const metadataScoreVal = normMeta.get(row.id) ?? 0;
    const hybridScore =
      weights.semantic * semanticScore +
      weights.keyword * keywordScoreVal +
      weights.metadata * metadataScoreVal;

    return {
      ...row,
      hybridScore,
      semanticScore,
      keywordScoreVal,
      metadataScoreVal,
    };
  });
}

export function sortByHybridScore(
  candidates: HybridChunkCandidate[],
): HybridChunkCandidate[] {
  return [...candidates].sort(
    (a, b) => b.hybridScore - a.hybridScore || a.chunk_index - b.chunk_index,
  );
}

export function selectTopHybridChunks(
  candidates: HybridChunkCandidate[],
  maxChunks: number,
  minScore = 0,
): HybridChunkCandidate[] {
  const sorted = sortByHybridScore(candidates);
  const withScore = sorted.filter((c) => c.hybridScore > minScore);
  const selected = withScore.length > 0 ? withScore : sorted;
  return selected.slice(0, maxChunks);
}
