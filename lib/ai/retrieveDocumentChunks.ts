import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadHybridCandidates,
  selectTopHybridChunks,
} from "@/lib/ai/retrieval/hybridRetrieval";

export interface DocumentChunkRow {
  id: string;
  document_id: string;
  project_id: string;
  page_start: number;
  page_end: number;
  chunk_index: number;
  chunk_text: string;
  token_count: number | null;
}

export interface DocumentCitation {
  documentId: string;
  fileName: string;
  pageStart: number;
  pageEnd: number;
}

export interface RetrievedChunkContext {
  promptText: string;
  citations: DocumentCitation[];
}

const MAX_CHUNKS = 12;

function formatPageRange(start: number, end: number): string {
  return start === end ? `page ${start}` : `pages ${start}–${end}`;
}

/**
 * Retrieve the most relevant document chunks for a user message (hybrid when enabled).
 */
export async function retrieveDocumentChunks(
  supabase: SupabaseClient,
  projectId: string,
  documentIds: string[],
  userMessage: string,
  fileNamesByDocId: Record<string, string>,
  options?: { preferredPagesByDocId?: Record<string, number[]> },
): Promise<RetrievedChunkContext> {
  if (documentIds.length === 0) {
    return { promptText: "", citations: [] };
  }

  const candidates = await loadHybridCandidates(
    supabase,
    projectId,
    documentIds,
    userMessage,
    fileNamesByDocId,
    { preferredPagesByDocId: options?.preferredPagesByDocId },
  );

  if (candidates.length === 0) {
    return { promptText: "", citations: [] };
  }

  const selected = selectTopHybridChunks(candidates, MAX_CHUNKS);

  const citations: DocumentCitation[] = [];
  const blocks = selected.map((chunk) => {
    const fileName = fileNamesByDocId[chunk.document_id] ?? "Document";
    citations.push({
      documentId: chunk.document_id,
      fileName,
      pageStart: chunk.page_start,
      pageEnd: chunk.page_end,
    });
    return `### ${fileName} (${formatPageRange(chunk.page_start, chunk.page_end)})\n${chunk.chunk_text}`;
  });

  return {
    promptText: blocks.join("\n\n---\n\n"),
    citations,
  };
}
