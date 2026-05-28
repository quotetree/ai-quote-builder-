import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectTitleBlockFromPageText,
  detectTitleBlockFromPdfPage,
  type TitleBlockDetection,
} from "@/lib/ai/plan/detectTitleBlock";
import { TITLE_BLOCK_CROP } from "@/lib/ai/plan/pageImageRender";

export interface SheetIndexProgress {
  sheetsDetectedUpTo: number;
}

async function applyDetectionToPage(
  supabase: SupabaseClient,
  documentId: string,
  pageNumber: number,
  detection: TitleBlockDetection,
): Promise<void> {
  await supabase
    .from("document_pages")
    .update({
      sheet_number: detection.sheet_number,
      sheet_title: detection.sheet_title,
      discipline: detection.discipline,
      trade: detection.trade,
      revision: detection.revision,
      title_block_confidence: detection.confidence,
      title_block_bbox: TITLE_BLOCK_CROP,
    })
    .eq("document_id", documentId)
    .eq("page_number", pageNumber);
}

/**
 * Run title-block detection for each page and rebuild document_sheet_index.
 */
export async function runSheetIndexDetection(
  supabase: SupabaseClient,
  projectId: string,
  documentId: string,
  pdfBuffer: Buffer,
  pageCount: number,
  startFromPage: number,
  deadlineMs: number,
  options?: { useVision?: boolean },
): Promise<SheetIndexProgress> {
  const useVision = options?.useVision !== false && Boolean(process.env.OPENAI_API_KEY);
  let sheetsDetectedUpTo = startFromPage;

  for (let pageNum = startFromPage + 1; pageNum <= pageCount; pageNum++) {
    if (Date.now() >= deadlineMs) break;

    const { data: pageRow } = await supabase
      .from("document_pages")
      .select("native_text, ocr_text, sheet_number")
      .eq("document_id", documentId)
      .eq("page_number", pageNum)
      .maybeSingle();

    if (pageRow?.sheet_number) {
      sheetsDetectedUpTo = pageNum;
      continue;
    }

    let detection: TitleBlockDetection = detectTitleBlockFromPageText(
      pageRow?.native_text ?? null,
      pageRow?.ocr_text ?? null,
    );

    if (useVision && (detection.confidence < 0.6 || !detection.sheet_number)) {
      const vision = await detectTitleBlockFromPdfPage(pdfBuffer, pageNum);
      if (vision.confidence >= detection.confidence) {
        detection = vision;
      }
    }

    await applyDetectionToPage(supabase, documentId, pageNum, detection);
    sheetsDetectedUpTo = pageNum;
  }

  if (sheetsDetectedUpTo >= pageCount || Date.now() < deadlineMs) {
    await rebuildDocumentSheetIndex(supabase, projectId, documentId);
  }

  return { sheetsDetectedUpTo };
}

export async function rebuildDocumentSheetIndex(
  supabase: SupabaseClient,
  projectId: string,
  documentId: string,
): Promise<void> {
  await supabase.from("document_sheet_index").delete().eq("document_id", documentId);

  const { data: pages } = await supabase
    .from("document_pages")
    .select(
      "page_number, sheet_number, sheet_title, discipline, trade, revision, title_block_confidence",
    )
    .eq("document_id", documentId)
    .not("sheet_number", "is", null)
    .order("page_number", { ascending: true });

  if (!pages?.length) return;

  const seen = new Set<string>();
  const rows = [];
  for (const p of pages) {
    const num = p.sheet_number?.trim();
    if (!num || seen.has(num.toUpperCase())) continue;
    seen.add(num.toUpperCase());
    rows.push({
      document_id: documentId,
      project_id: projectId,
      sheet_number: num,
      sheet_title: p.sheet_title,
      discipline: p.discipline,
      trade: p.trade,
      page_number: p.page_number,
      revision: p.revision,
      confidence: p.title_block_confidence,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("document_sheet_index").insert(rows);
    if (error) throw new Error(error.message);
  }
}
