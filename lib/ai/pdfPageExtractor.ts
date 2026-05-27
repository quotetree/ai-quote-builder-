import path from "node:path";
import { pathToFileURL } from "node:url";

export interface PdfPageText {
  pageNumber: number;
  text: string;
}

export interface PdfExtractionResult {
  pageCount: number;
  pages: PdfPageText[];
}

function configurePdfJsWorker(
  GlobalWorkerOptions: { workerSrc: string },
): void {
  const workerPath = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  );
  GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
}

/**
 * Extract text from each page of a PDF (server-side).
 * Uses pdfjs-dist legacy build — the standard build expects a browser worker URL.
 */
export async function extractPdfPages(buffer: Buffer): Promise<PdfExtractionResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs.GlobalWorkerOptions);

  const data = new Uint8Array(buffer);
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pageCount = pdf.numPages;
  const pages: PdfPageText[] = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    pages.push({ pageNumber: pageNum, text });
  }

  return { pageCount, pages };
}
