import { MIN_NATIVE_TEXT_CHARS } from "@/lib/ai/documentProcessingConfig";

const PLAN_FILENAME_RE =
  /\b(plan|drawing|drawings|arch|architectural|electrical|site|floor|riser|schematic|layout|dwg|blueprint|construction|mep|fa\b|fire alarm|security)\b/i;

export function isPlanPageImagesEnabled(): boolean {
  return process.env.PLAN_PAGE_IMAGES_ENABLED === "true";
}

export function planPageImagesMaxPages(): number {
  const n = parseInt(process.env.PLAN_PAGE_IMAGES_MAX_PAGES ?? "300", 10);
  return Number.isFinite(n) && n > 0 ? n : 300;
}

export function planPageRenderScale(): number {
  const n = parseFloat(process.env.PLAN_PAGE_RENDER_SCALE ?? "1.5");
  return Number.isFinite(n) && n > 0 ? n : 1.5;
}

export interface PageTextSample {
  page_number: number;
  native_text: string | null;
  ocr_text: string | null;
}

/**
 * Heuristic: render page images for likely drawing sets, not text-only RFPs.
 */
export function shouldRenderPlanPageImages(
  fileName: string,
  pages: PageTextSample[],
): boolean {
  if (!isPlanPageImagesEnabled()) return false;
  if (PLAN_FILENAME_RE.test(fileName)) return true;

  if (pages.length === 0) return false;
  const sparse = pages.filter((p) => {
    const len = (p.native_text?.trim().length ?? 0) + (p.ocr_text?.trim().length ?? 0);
    return len < MIN_NATIVE_TEXT_CHARS;
  }).length;
  return sparse / pages.length >= 0.25;
}

export function buildPageImageStoragePath(
  projectId: string,
  documentId: string,
  pageNumber: number,
): string {
  return `project-${projectId}/doc-pages/${documentId}/p-${pageNumber}.webp`;
}
