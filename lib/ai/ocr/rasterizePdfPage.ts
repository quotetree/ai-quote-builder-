import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PdfPageText } from "@/lib/ai/pdfPageExtractor";

function configurePdfJsWorker(GlobalWorkerOptions: { workerSrc: string }): void {
  const workerPath = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  );
  GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
}

/**
 * Render a single PDF page to PNG bytes (server-side, for OCR).
 */
export async function rasterizePdfPage(
  pdfBuffer: Buffer,
  pageNumber: number,
  scale = 2,
): Promise<Buffer> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs.GlobalWorkerOptions);

  const { createCanvas } = await import("@napi-rs/canvas");
  const data = new Uint8Array(pdfBuffer);
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");

  await page.render({
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  return canvas.toBuffer("image/png");
}

export function pagesToPdfPageText(
  rows: { page_number: number; native_text: string | null; ocr_text: string | null }[],
): PdfPageText[] {
  return rows.map((row) => ({
    pageNumber: row.page_number,
    text: combinePageText(row.native_text, row.ocr_text),
  }));
}

export function combinePageText(native: string | null, ocr: string | null): string {
  const n = native?.trim() ?? "";
  const o = ocr?.trim() ?? "";
  if (o && n.length < 50) return o;
  if (o && n) return `${o}\n${n}`;
  return n || o;
}
