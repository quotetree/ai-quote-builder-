import OpenAI from "openai";
import {
  inferDisciplineFromSheetNumber,
  normalizeSheetNumber,
} from "@/lib/ai/plan/sheetDiscipline";
import { rasterizeTitleBlockCrop } from "@/lib/ai/plan/pageImageRender";
import { planPageRenderScale } from "@/lib/ai/plan/planPageConfig";

export interface TitleBlockDetection {
  sheet_number: string | null;
  sheet_title: string | null;
  discipline: string | null;
  trade: string | null;
  revision: string | null;
  confidence: number;
}

const EMPTY: TitleBlockDetection = {
  sheet_number: null,
  sheet_title: null,
  discipline: null,
  trade: null,
  revision: null,
  confidence: 0,
};

function parseDetection(raw: string): TitleBlockDetection {
  try {
    const parsed = JSON.parse(raw) as TitleBlockDetection & { confidence?: number };
    const sheet_number = parsed.sheet_number
      ? normalizeSheetNumber(String(parsed.sheet_number))
      : null;
    const inferred = inferDisciplineFromSheetNumber(sheet_number);
    return {
      sheet_number,
      sheet_title: parsed.sheet_title?.trim() || null,
      discipline: parsed.discipline?.trim() || inferred?.discipline || null,
      trade: parsed.trade?.trim() || inferred?.trade || null,
      revision: parsed.revision?.trim() || null,
      confidence:
        typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.7,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Detect sheet number/title from title block crop via GPT-4o vision.
 */
export async function detectTitleBlockFromPdfPage(
  pdfBuffer: Buffer,
  pageNumber: number,
): Promise<TitleBlockDetection> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return EMPTY;

  try {
    const cropPng = await rasterizeTitleBlockCrop(pdfBuffer, pageNumber, planPageRenderScale());
    const base64 = cropPng.toString("base64");
    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content:
            'Extract construction drawing title block fields from the image crop. Return JSON: { "sheet_number", "sheet_title", "discipline", "trade", "revision", "confidence" }. Use null when unknown. sheet_number examples: A-101, E-401, FA-102. discipline examples: architectural, electrical, fire alarm. trade examples: electrical, low_voltage, fire_alarm, security, mechanical.',
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Title block crop from a construction plan sheet. Extract sheet number and title.",
            },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${base64}` },
            },
          ],
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return EMPTY;
    return parseDetection(content);
  } catch (err) {
    console.error(`[title-block] page ${pageNumber} detection failed`, err);
    return EMPTY;
  }
}

/** Fallback: infer sheet number from page text (native + OCR). */
export function detectTitleBlockFromPageText(
  nativeText: string | null,
  ocrText: string | null,
): TitleBlockDetection {
  const combined = `${nativeText ?? ""}\n${ocrText ?? ""}`;
  const sheetMatch = combined.match(
    /\b(?:sheet|drawing|dwg|sht)\s*[#.:]?\s*([A-Z]{1,4}[\s\-_.]?\d{1,4}(?:\.\d+)?)\b/i,
  );
  const titleMatch = combined.match(/\b([A-Z0-9][A-Z0-9\s\-/]{4,60})\b/);

  const sheet_number = sheetMatch
    ? normalizeSheetNumber(sheetMatch[1].replace(/[\s_.]+/g, "-"))
    : null;
  const inferred = inferDisciplineFromSheetNumber(sheet_number);

  if (!sheet_number && !titleMatch) return EMPTY;

  return {
    sheet_number,
    sheet_title: titleMatch?.[1]?.trim().slice(0, 80) ?? null,
    discipline: inferred?.discipline ?? null,
    trade: inferred?.trade ?? null,
    revision: null,
    confidence: sheet_number ? 0.55 : 0.35,
  };
}
