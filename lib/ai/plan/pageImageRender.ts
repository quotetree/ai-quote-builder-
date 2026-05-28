import sharp from "sharp";
import { rasterizePdfPage } from "@/lib/ai/ocr/rasterizePdfPage";

/** Normalized crop region (0–1). Default: bottom-right title block. */
export const TITLE_BLOCK_CROP = {
  left: 0.72,
  top: 0.72,
  width: 0.28,
  height: 0.28,
};

export async function rasterizePdfPageToWebp(
  pdfBuffer: Buffer,
  pageNumber: number,
  scale: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const png = await rasterizePdfPage(pdfBuffer, pageNumber, scale);
  const webp = await sharp(png).webp({ quality: 82 }).toBuffer();
  const meta = await sharp(webp).metadata();
  return {
    buffer: webp,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

export async function cropTitleBlockFromPagePng(
  pagePng: Buffer,
  crop = TITLE_BLOCK_CROP,
): Promise<Buffer> {
  const meta = await sharp(pagePng).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const left = Math.floor(w * crop.left);
  const top = Math.floor(h * crop.top);
  const width = Math.min(Math.floor(w * crop.width), w - left);
  const height = Math.min(Math.floor(h * crop.height), h - top);
  return sharp(pagePng).extract({ left, top, width, height }).png().toBuffer();
}

export async function rasterizeTitleBlockCrop(
  pdfBuffer: Buffer,
  pageNumber: number,
  scale: number,
): Promise<Buffer> {
  const png = await rasterizePdfPage(pdfBuffer, pageNumber, scale);
  return cropTitleBlockFromPagePng(png);
}
