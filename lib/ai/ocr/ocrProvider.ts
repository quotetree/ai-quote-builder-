import { TextractOcrProvider } from "@/lib/ai/ocr/textractProvider";

export interface OcrResult {
  text: string;
  confidence: number;
}

export interface OcrProvider {
  detectText(imageBuffer: Buffer): Promise<OcrResult>;
}

export function getOcrProvider(): OcrProvider | null {
  if (process.env.OCR_ENABLED !== "true") return null;
  const provider = process.env.OCR_PROVIDER ?? "textract";
  if (provider !== "textract") return null;
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.warn("[ocr] OCR_ENABLED but AWS credentials missing — skipping OCR");
    return null;
  }
  return new TextractOcrProvider();
}
