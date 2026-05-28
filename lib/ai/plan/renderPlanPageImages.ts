import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPageImageStoragePath,
  planPageImagesMaxPages,
  planPageRenderScale,
} from "@/lib/ai/plan/planPageConfig";
import { rasterizePdfPageToWebp } from "@/lib/ai/plan/pageImageRender";

export interface PageImageProgress {
  imagesRenderedUpTo: number;
}

/**
 * Render PDF pages to WebP and upload to project-files storage.
 */
export async function renderPlanPageImages(
  supabase: SupabaseClient,
  projectId: string,
  documentId: string,
  pdfBuffer: Buffer,
  pageCount: number,
  startFromPage: number,
  deadlineMs: number,
): Promise<PageImageProgress> {
  const scale = planPageRenderScale();
  const maxPages = Math.min(pageCount, planPageImagesMaxPages());
  let imagesRenderedUpTo = startFromPage;

  for (let pageNum = startFromPage + 1; pageNum <= maxPages; pageNum++) {
    if (Date.now() >= deadlineMs) break;

    const { data: existing } = await supabase
      .from("document_pages")
      .select("storage_path")
      .eq("document_id", documentId)
      .eq("page_number", pageNum)
      .maybeSingle();

    if (existing?.storage_path) {
      imagesRenderedUpTo = pageNum;
      continue;
    }

    try {
      const rendered = await rasterizePdfPageToWebp(pdfBuffer, pageNum, scale);
      const storagePath = buildPageImageStoragePath(projectId, documentId, pageNum);

      const { error: uploadError } = await supabase.storage
        .from("project-files")
        .upload(storagePath, rendered.buffer, {
          contentType: "image/webp",
          upsert: true,
          cacheControl: "3600",
        });

      if (uploadError) throw new Error(uploadError.message);

      await supabase
        .from("document_pages")
        .update({
          storage_path: storagePath,
          width_px: rendered.width,
          height_px: rendered.height,
        })
        .eq("document_id", documentId)
        .eq("page_number", pageNum);

      imagesRenderedUpTo = pageNum;
    } catch (err) {
      console.error(`[plan-images] page ${pageNum} failed`, err);
      imagesRenderedUpTo = pageNum;
    }
  }

  return { imagesRenderedUpTo };
}
