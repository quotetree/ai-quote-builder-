/** Shared limits for unified PDF processing (Drive + Copilot). */
export const MAX_PDF_PROCESSING_BYTES = 150 * 1024 * 1024;
export const MAX_DRIVE_INLINE_INDEX_BYTES = 25 * 1024 * 1024;

export const MIN_NATIVE_TEXT_CHARS = 50;
export const OCR_MAX_PAGES_DEFAULT = 200;

export type ProcessingPhase =
  | "pages"
  | "ocr"
  | "page_images"
  | "sheet_index"
  | "chunks"
  | "extractions";

export interface ProcessingProgress {
  phase?: ProcessingPhase;
  pageCount?: number;
  pagesWritten?: number;
  ocrCompletedUpTo?: number;
  imagesRenderedUpTo?: number;
  sheetsDetectedUpTo?: number;
  chunksInserted?: number;
  extractionsComplete?: boolean;
  planImagesEnabled?: boolean;
}

export function isPdfMime(mimeType: string, fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return mimeType === "application/pdf" || lower.endsWith(".pdf");
}

export function isOcrEnabled(): boolean {
  return process.env.OCR_ENABLED === "true";
}

export function ocrMaxPagesPerDoc(): number {
  const raw = process.env.OCR_MAX_PAGES_PER_DOC;
  const n = raw ? parseInt(raw, 10) : OCR_MAX_PAGES_DEFAULT;
  return Number.isFinite(n) && n > 0 ? n : OCR_MAX_PAGES_DEFAULT;
}

export function isHybridRetrievalEnabled(): boolean {
  return process.env.ENABLE_CHUNK_EMBEDDINGS === "true" && Boolean(process.env.OPENAI_API_KEY);
}

export function hybridWeights(): { semantic: number; keyword: number; metadata: number } {
  const semantic = parseFloat(process.env.HYBRID_SEMANTIC_WEIGHT ?? "0.5");
  const keyword = parseFloat(process.env.HYBRID_KEYWORD_WEIGHT ?? "0.3");
  const metadata = parseFloat(process.env.HYBRID_METADATA_WEIGHT ?? "0.2");
  const sum = semantic + keyword + metadata;
  if (sum <= 0) return { semantic: 0.5, keyword: 0.3, metadata: 0.2 };
  return { semantic: semantic / sum, keyword: keyword / sum, metadata: metadata / sum };
}

export function semanticMatchCount(): number {
  const n = parseInt(process.env.SEMANTIC_MATCH_COUNT ?? "50", 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}
