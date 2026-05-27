import type { PdfPageText } from "@/lib/ai/pdfPageExtractor";
import type { DocumentChunkDraft } from "@/lib/ai/chunkDocumentText";

const TARGET_TOKENS = 1000;
const TABLE_PAGE_MAX_TOKENS = 800;
const OVERLAP_TOKENS = 100;
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

function isTableHeavyPage(text: string): boolean {
  if (!text.trim()) return false;
  const lines = text.split(/\n/).filter((l) => l.trim().length > 0);
  const tabLines = lines.filter((l) => l.includes("\t")).length;
  const numericLines = lines.filter((l) => (l.match(/\d/g) ?? []).length >= 4).length;
  return (
    tabLines >= 2 ||
    (numericLines >= 3 && lines.length >= 4) ||
    /\b(qty|quantity|clin|item|unit|schedule)\b/i.test(text)
  );
}

function formatPageBlock(page: PdfPageText, preserveLayout: boolean): string {
  const body = preserveLayout ? page.text : page.text.replace(/\s+/g, " ").trim();
  return `[Page ${page.pageNumber}]\n${body}`;
}

/**
 * Chunk pages with table-aware rules: table-heavy pages stay intact when possible.
 */
export function chunkDocumentPagesWithTables(pages: PdfPageText[]): DocumentChunkDraft[] {
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
    const page = nonEmpty[i];
    const tableHeavy = isTableHeavyPage(page.text);

    if (tableHeavy) {
      const parts: string[] = [formatPageBlock(page, true)];
      let pageEnd = page.pageNumber;
      let tokenTotal = estimateTokens(parts[0]);
      let j = i + 1;

      while (j < nonEmpty.length && isTableHeavyPage(nonEmpty[j].text)) {
        const nextBlock = formatPageBlock(nonEmpty[j], true);
        const nextTokens = estimateTokens(nextBlock);
        if (tokenTotal + nextTokens > TABLE_PAGE_MAX_TOKENS) break;
        parts.push(nextBlock);
        pageEnd = nonEmpty[j].pageNumber;
        tokenTotal += nextTokens;
        j++;
      }

      const chunkText = parts.join("\n\n");
      chunks.push({
        page_start: page.pageNumber,
        page_end: pageEnd,
        chunk_index: chunkIndex++,
        chunk_text: chunkText,
        token_count: estimateTokens(chunkText),
      });
      i = j;
      continue;
    }

    const parts: string[] = [];
    let pageStart = page.pageNumber;
    let pageEnd = pageStart;
    let tokenTotal = 0;
    const startIdx = i;

    while (i < nonEmpty.length && !isTableHeavyPage(nonEmpty[i].text)) {
      const p = nonEmpty[i];
      const block = formatPageBlock(p, false);
      const blockTokens = estimateTokens(block);

      if (tokenTotal > 0 && tokenTotal + blockTokens > TARGET_TOKENS) break;

      parts.push(block);
      pageEnd = p.pageNumber;
      tokenTotal += blockTokens;
      i++;

      if (tokenTotal >= TARGET_TOKENS) break;
    }

    if (parts.length === 0 && i < nonEmpty.length) {
      const p = nonEmpty[i];
      parts.push(formatPageBlock(p, false));
      pageEnd = p.pageNumber;
      tokenTotal = estimateTokens(parts[0]);
      i++;
    }

    const chunkText = parts.join("\n\n");
    chunks.push({
      page_start: pageStart,
      page_end: pageEnd,
      chunk_index: chunkIndex++,
      chunk_text: chunkText,
      token_count: estimateTokens(chunkText),
    });

    if (i >= nonEmpty.length) break;

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
