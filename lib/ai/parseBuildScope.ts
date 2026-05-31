import OpenAI from "openai";
import { BUILD_EXTRACT_SYSTEM_PROMPT } from "@/lib/ai/buildPrompts";
import type { BuildExtractedItem, BuildLineItemKind } from "@/lib/ai/buildTypes";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface RawExtractedItem {
  kind?: string;
  requestedLabel?: string;
  searchQuery?: string;
  quantity?: number;
  unit?: string;
  discountPercent?: number;
  lumpSumAmount?: number;
}

function normalizeKind(raw: string | undefined): BuildLineItemKind {
  return raw === "labor_lump_sum" ? "labor_lump_sum" : "product";
}

function stripAmountFromLabel(label: string): string {
  return label
    .replace(/\$[\d,]+(?:\.\d+)?/g, "")
    .replace(/\bin\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDollarAmount(text: string): number {
  const match = text.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (!match) return 0;
  return Math.max(0, Number(match[1].replace(/,/g, "")) || 0);
}

function normalizeItem(raw: RawExtractedItem, index: number): BuildExtractedItem {
  const kind = normalizeKind(raw.kind);
  const quantity = Math.max(1, Number(raw.quantity) || 1);
  const discountPercent = 0;
  const unit = (raw.unit?.trim() || (kind === "labor_lump_sum" ? "ls" : "ea")).toLowerCase();
  const requestedLabel = raw.requestedLabel?.trim() || `Item ${index + 1}`;
  const searchQuery =
    kind === "labor_lump_sum"
      ? raw.searchQuery?.trim() || stripAmountFromLabel(requestedLabel)
      : raw.searchQuery?.trim() || requestedLabel;

  const lumpSumFromRaw =
    raw.lumpSumAmount != null ? Math.max(0, Number(raw.lumpSumAmount) || 0) : 0;
  const lumpSumAmount =
    kind === "labor_lump_sum"
      ? lumpSumFromRaw || extractDollarAmount(requestedLabel)
      : undefined;

  return {
    id: crypto.randomUUID(),
    kind,
    requestedLabel,
    searchQuery,
    quantity: kind === "labor_lump_sum" ? 1 : quantity,
    unit,
    discountPercent,
    lumpSumAmount: kind === "labor_lump_sum" ? lumpSumAmount : undefined,
  };
}

export async function parseBuildScope(message: string): Promise<BuildExtractedItem[]> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: BUILD_EXTRACT_SYSTEM_PROMPT },
      { role: "user", content: message.trim() },
    ],
  });

  const content = completion.choices[0]?.message?.content?.trim() ?? "{}";
  let parsed: { items?: RawExtractedItem[] };
  try {
    parsed = JSON.parse(content) as { items?: RawExtractedItem[] };
  } catch {
    throw new Error("Failed to parse scope extraction response");
  }

  const items = (parsed.items ?? []).map(normalizeItem);
  if (items.length === 0) {
    throw new Error("No line items found in your scope. Try listing products with quantities.");
  }
  return items;
}
