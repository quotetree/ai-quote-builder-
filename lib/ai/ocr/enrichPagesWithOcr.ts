import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MIN_NATIVE_TEXT_CHARS,
  ocrMaxPagesPerDoc,
} from "@/lib/ai/documentProcessingConfig";
import { getOcrProvider } from "@/lib/ai/ocr/ocrProvider";
import { rasterizePdfPage } from "@/lib/ai/ocr/rasterizePdfPage";

export interface OcrPageProgress {
  ocrCompletedUpTo: number;
  ocrPagesRun: number;
}

/**
 * OCR sparse pages stored in document_pages. Returns when deadline hit or done.
 */
export async function runOcrOnSparsePages(
  supabase: SupabaseClient,
  documentId: string,
  projectId: string,
  pdfBuffer: Buffer,
  pageCount: number,
  startFromPage: number,
  deadlineMs: number,
): Promise<OcrPageProgress> {
  const provider = getOcrProvider();
  if (!provider) {
    return { ocrCompletedUpTo: pageCount, ocrPagesRun: 0 };
  }

  const maxPages = ocrMaxPagesPerDoc();
  let ocrPagesRun = 0;
  let ocrCompletedUpTo = startFromPage;

  for (let pageNum = startFromPage + 1; pageNum <= pageCount; pageNum++) {
    if (Date.now() >= deadlineMs) break;
    if (ocrPagesRun >= maxPages) break;

    const { data: pageRow } = await supabase
      .from("document_pages")
      .select("id, native_text, ocr_text")
      .eq("document_id", documentId)
      .eq("page_number", pageNum)
      .maybeSingle();

    const nativeLen = pageRow?.native_text?.trim().length ?? 0;
    if (nativeLen >= MIN_NATIVE_TEXT_CHARS || pageRow?.ocr_text) {
      ocrCompletedUpTo = pageNum;
      continue;
    }

    try {
      const png = await rasterizePdfPage(pdfBuffer, pageNum);
      const result = await provider.detectText(png);
      ocrPagesRun += 1;

      const method = nativeLen > 0 ? "hybrid" : "ocr";
      await supabase
        .from("document_pages")
        .update({
          ocr_text: result.text || null,
          extraction_method: result.text ? method : "empty",
          ocr_confidence: result.confidence,
        })
        .eq("document_id", documentId)
        .eq("page_number", pageNum);

      ocrCompletedUpTo = pageNum;
    } catch (err) {
      console.error(`[ocr] page ${pageNum} failed`, err);
      ocrCompletedUpTo = pageNum;
    }
  }

  return { ocrCompletedUpTo, ocrPagesRun };
}

export function pageNeedsOcr(nativeText: string | null): boolean {
  return (nativeText?.trim().length ?? 0) < MIN_NATIVE_TEXT_CHARS;
}
