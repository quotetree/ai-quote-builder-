import type { PdfPageText } from "@/lib/ai/pdfPageExtractor";

export interface DocumentChunkDraft {
  page_start: number;
  page_end: number;
  chunk_index: number;
  chunk_text: string;
  token_count: number;
}

const TARGET_TOKENS = 1000;
const OVERLAP_TOKENS = 100;
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/**
 * Chunk page text with overlap while keeping page boundaries when possible.
 */
export function chunkDocumentPages(pages: PdfPageText[]): DocumentChunkDraft[] {
  const nonEmpty = pages.filter((p) => p.text.length > 0);
  if (nonEmpty.length === 0) {
    const fallback = pages.length > 0 ? pages : [{ pageNumber: 1, text: "" }];
    return [
      {
        page_start: fallback[0].pageNumber,
        page_end: fallback[fallback.length - 1].pageNumber,
        chunk_index: 0,
        chunk_text: "(No extractable text in this PDF.)",
        token_count: 1,
      },
    ];
  }

  const chunks: DocumentChunkDraft[] = [];
  let chunkIndex = 0;
  let i = 0;

  while (i < nonEmpty.length) {
    const parts: string[] = [];
    let pageStart = nonEmpty[i].pageNumber;
    let pageEnd = pageStart;
    let tokenTotal = 0;
    let startIdx = i;

    while (i < nonEmpty.length) {
      const page = nonEmpty[i];
      const pageBlock = `[Page ${page.pageNumber}]\n${page.text}`;
      const pageTokens = estimateTokens(pageBlock);

      if (tokenTotal > 0 && tokenTotal + pageTokens > TARGET_TOKENS) {
        break;
      }

      parts.push(pageBlock);
      pageEnd = page.pageNumber;
      tokenTotal += pageTokens;
      i++;

      if (tokenTotal >= TARGET_TOKENS) break;
    }

    if (parts.length === 0 && i < nonEmpty.length) {
      const page = nonEmpty[i];
      parts.push(`[Page ${page.pageNumber}]\n${page.text}`);
      pageEnd = page.pageNumber;
      tokenTotal = estimateTokens(parts[0]);
      i++;
    }

    const chunkText = parts.join("\n\n");
    chunks.push({
      page_start: pageStart,
      page_end: pageEnd,
      chunk_index: chunkIndex,
      chunk_text: chunkText,
      token_count: estimateTokens(chunkText),
    });
    chunkIndex++;

    if (i >= nonEmpty.length) break;

    // Overlap: step back by pages approximating OVERLAP_TOKENS
    let overlapTokens = 0;
    let back = i - 1;
    while (back > startIdx && overlapTokens < OVERLAP_TOKENS) {
      overlapTokens += estimateTokens(nonEmpty[back].text);
      back--;
    }
    i = Math.max(startIdx + 1, back + 1);
  }

  return chunks;
}
