export interface RfpRetrievalDebugPayload {
  intents: string[];
  isRfpAnalysisMode: boolean;
  expandedQueries: Record<string, string[]>;
  retrievedChunkIds: string[];
  pageRanges: { chunkId: string; fileName: string; pageStart: number; pageEnd: number }[];
  scoringReasons: Record<string, string[]>;
  tableChunksIncluded: number;
  totalTokens: number;
  chunkCount: number;
}

export function isRfpRetrievalDebugEnabled(): boolean {
  return (
    process.env.RFP_RETRIEVAL_DEBUG === "true" ||
    process.env.NODE_ENV === "development"
  );
}

export function logRfpRetrievalDebug(payload: RfpRetrievalDebugPayload): void {
  if (!isRfpRetrievalDebugEnabled()) return;
  console.log(
    `[rfp-retrieval] ${JSON.stringify({
      intents: payload.intents,
      isRfpAnalysisMode: payload.isRfpAnalysisMode,
      chunkCount: payload.chunkCount,
      totalTokens: payload.totalTokens,
      tableChunksIncluded: payload.tableChunksIncluded,
      retrievedChunkIds: payload.retrievedChunkIds.slice(0, 40),
      pageRanges: payload.pageRanges.slice(0, 20),
      expandedQueryCounts: Object.fromEntries(
        Object.entries(payload.expandedQueries).map(([k, v]) => [k, v.length]),
      ),
    })}`,
  );
}
