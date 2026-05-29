import OpenAI from "openai";
import Papa from "papaparse";
import {
  FLOOR_PLAN_VISION_JSON_PROMPT,
  floorPlanVisionImageUrl,
  isLikelyFloorPlanFileName,
} from "@/lib/ai/plan/floorPlanVision";

const MAX_EXTRACT_CHARS = 120_000;
const MAX_VISION_CHARS = 8_000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[Truncated for length…]`;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Import the parser directly — the package entrypoint runs debug self-tests when
  // loaded as an ES module (module.parent is undefined), which throws ENOENT.
  const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
  const data = await pdfParse(buffer);
  return data.text?.trim() ?? "";
}

async function extractImageWithVision(
  openai: OpenAI,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const base64 = buffer.toString("base64");
  const floorPlan = isLikelyFloorPlanFileName(fileName);
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: floorPlan ? 0.1 : 0.2,
    max_tokens: floorPlan ? 2500 : 1500,
    ...(floorPlan ? { response_format: { type: "json_object" as const } } : {}),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: floorPlan
              ? `File: ${fileName}\n\n${FLOOR_PLAN_VISION_JSON_PROMPT}`
              : "Describe this image for a low-voltage/security estimator. Include visible text, quantities, and equipment.",
          },
          {
            type: "image_url",
            image_url: floorPlan
              ? floorPlanVisionImageUrl(base64, mimeType)
              : { url: `data:${mimeType};base64,${base64}`, detail: "high" },
          },
        ],
      },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() ?? "";
}

export interface ExtractedFileContent {
  extractedText: string | null;
  visionSummary: string | null;
  parseStatus: "ready" | "error";
  parseError: string | null;
}

export async function extractFileContent(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ExtractedFileContent> {
  const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

  try {
    const lower = fileName.toLowerCase();
    let text = "";

    if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
      text = await extractPdfText(buffer);
    } else if (
      mimeType.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp)$/i.test(lower)
    ) {
      if (!openai) throw new Error("OpenAI required for image analysis");
      const vision = await extractImageWithVision(openai, buffer, mimeType, fileName);
      return {
        extractedText: null,
        visionSummary: truncate(vision, MAX_VISION_CHARS),
        parseStatus: "ready",
        parseError: null,
      };
    } else if (
      mimeType.includes("csv") ||
      mimeType.includes("spreadsheet") ||
      lower.endsWith(".csv")
    ) {
      const parsed = Papa.parse(buffer.toString("utf8"), { header: false });
      text = (parsed.data as string[][])
        .slice(0, 500)
        .map((row) => row.join("\t"))
        .join("\n");
    } else if (
      mimeType.startsWith("text/") ||
      lower.endsWith(".txt") ||
      lower.endsWith(".md")
    ) {
      text = buffer.toString("utf8");
    } else {
      return {
        extractedText: null,
        visionSummary: null,
        parseStatus: "ready",
        parseError: null,
      };
    }

    return {
      extractedText: text ? truncate(text, MAX_EXTRACT_CHARS) : null,
      visionSummary: null,
      parseStatus: "ready",
      parseError: null,
    };
  } catch (err) {
    return {
      extractedText: null,
      visionSummary: null,
      parseStatus: "error",
      parseError: err instanceof Error ? err.message : "Parse failed",
    };
  }
}
