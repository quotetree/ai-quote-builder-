import OpenAI from "openai";
import { BUILD_ANALYZE_SYSTEM_PROMPT } from "@/lib/ai/buildPrompts";
import type { BuildAnalyzeResult, BuildExplicitAdd, BuildUpdateInstruction } from "@/lib/applyBuildUpdates";
import { formatSpreadsheetLinesForPrompt } from "@/lib/applyBuildUpdates";
import type { SpreadsheetSection } from "@/types/database";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface RawUpdate {
  op?: string;
  target?: {
    scope?: string;
    sectionLabel?: string;
    productKeywords?: string[];
  };
  discountPercent?: number;
  quantity?: number;
  delta?: number;
  salesPrice?: number;
  description?: string;
}

interface RawExplicitAdd {
  requestedLabel?: string;
  searchQuery?: string;
  quantity?: number;
  unit?: string;
  discountPercent?: number;
}

interface RawAnalyze {
  intent?: string;
  taxOrMarkupRequested?: boolean;
  taxMarkupSummary?: string;
  explicitAdds?: RawExplicitAdd[];
  updates?: RawUpdate[];
}

const VALID_OPS = new Set([
  "set_discount",
  "set_quantity",
  "adjust_quantity",
  "set_sales_price",
  "adjust_sales_price",
]);

function normalizeExplicitAdd(raw: RawExplicitAdd): BuildExplicitAdd | null {
  const requestedLabel = raw.requestedLabel?.trim();
  const searchQuery = raw.searchQuery?.trim() || requestedLabel;
  if (!requestedLabel && !searchQuery) return null;

  return {
    requestedLabel: requestedLabel || searchQuery || "Product",
    searchQuery: searchQuery || requestedLabel || "",
    quantity: Math.max(1, Number(raw.quantity) || 1),
    unit: (raw.unit?.trim() || "ea").toLowerCase(),
    discountPercent: Math.min(100, Math.max(0, Number(raw.discountPercent) || 0)),
  };
}
function normalizeUpdate(raw: RawUpdate): BuildUpdateInstruction | null {
  const op = raw.op?.trim();
  if (!op || !VALID_OPS.has(op)) return null;

  const scope = raw.target?.scope;
  if (scope !== "all" && scope !== "section" && scope !== "product") return null;

  return {
    op: op as BuildUpdateInstruction["op"],
    target: {
      scope,
      sectionLabel: raw.target?.sectionLabel?.trim() || undefined,
      productKeywords: raw.target?.productKeywords?.filter(Boolean) ?? undefined,
    },
    discountPercent: raw.discountPercent,
    quantity: raw.quantity,
    delta: raw.delta,
    salesPrice: raw.salesPrice,
    description: raw.description?.trim(),
  };
}

export async function analyzeBuildMessage(
  message: string,
  sections: SpreadsheetSection[],
): Promise<BuildAnalyzeResult> {
  const spreadsheetLines = formatSpreadsheetLinesForPrompt(sections);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: BUILD_ANALYZE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `--- CURRENT SPREADSHEET ---\n${spreadsheetLines}\n\n--- USER MESSAGE ---\n${message.trim()}`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content?.trim() ?? "{}";
  let parsed: RawAnalyze;
  try {
    parsed = JSON.parse(content) as RawAnalyze;
  } catch {
    return { intent: "add", updates: [], explicitAdds: [], taxOrMarkupRequested: false };
  }

  const intent =
    parsed.intent === "update" || parsed.intent === "mixed" ? parsed.intent : "add";

  const updates = (parsed.updates ?? [])
    .map(normalizeUpdate)
    .filter((u): u is BuildUpdateInstruction => u !== null);

  const explicitAdds = (parsed.explicitAdds ?? [])
    .map(normalizeExplicitAdd)
    .filter((a): a is BuildExplicitAdd => a !== null);

  return {
    intent,
    updates,
    explicitAdds,
    taxOrMarkupRequested: Boolean(parsed.taxOrMarkupRequested),
    taxMarkupSummary: parsed.taxMarkupSummary?.trim(),
  };
}

/** Quick heuristic when no spreadsheet is open — skip LLM analyze for obvious update phrasing */
export function looksLikeUpdateRequest(message: string): boolean {
  return /\b(discount|quantity|qty|increase|decrease|change|update|adjust|set)\b/i.test(message) &&
    !/\b(add|need|quote|include|get|order)\b.*\b(new|more)\b/i.test(message);
}

export const TAX_MARKUP_NOTICE =
  "Tax and markup changes must be added manually in the spreadsheet editor (use the **+ Tax** or **+ Markup** buttons at the bottom of your spreadsheet). I can't apply those automatically from chat yet.";
