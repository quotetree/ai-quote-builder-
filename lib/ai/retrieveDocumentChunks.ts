import type { SupabaseClient } from "@supabase/supabase-js";

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

function tokenizeQuery(message: string): string[] {
  return message
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 2);
}

function scoreChunk(
  chunk: DocumentChunkRow,
  fileName: string,
  queryTerms: string[],
): number {
  if (queryTerms.length === 0) return 0;
  const hay = `${fileName}\n${chunk.chunk_text}`.toLowerCase();
  return queryTerms.reduce((score, term) => (hay.includes(term) ? score + 1 : 0), 0);
}

function formatPageRange(start: number, end: number): string {
  return start === end ? `page ${start}` : `pages ${start}–${end}`;
}

/**
 * Retrieve the most relevant document chunks for a user message.
 */
export async function retrieveDocumentChunks(
  supabase: SupabaseClient,
  projectId: string,
  documentIds: string[],
  userMessage: string,
  fileNamesByDocId: Record<string, string>,
): Promise<RetrievedChunkContext> {
  if (documentIds.length === 0) {
    return { promptText: "", citations: [] };
  }

  const { data: chunks, error } = await supabase
    .from("document_chunks")
    .select(
      "id, document_id, project_id, page_start, page_end, chunk_index, chunk_text, token_count",
    )
    .eq("project_id", projectId)
    .in("document_id", documentIds)
    .order("chunk_index", { ascending: true });

  if (error || !chunks?.length) {
    return { promptText: "", citations: [] };
  }

  const queryTerms = tokenizeQuery(userMessage);
  const rows = chunks as DocumentChunkRow[];

  const scored = rows
    .map((chunk) => ({
      chunk,
      score: scoreChunk(
        chunk,
        fileNamesByDocId[chunk.document_id] ?? "",
        queryTerms,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.chunk.chunk_index - b.chunk.chunk_index);

  const top =
    queryTerms.length > 0
      ? scored.filter((s) => s.score > 0).slice(0, MAX_CHUNKS)
      : scored.slice(0, MAX_CHUNKS);

  const selected =
    top.length > 0 ? top.map((s) => s.chunk) : rows.slice(0, MAX_CHUNKS);

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
