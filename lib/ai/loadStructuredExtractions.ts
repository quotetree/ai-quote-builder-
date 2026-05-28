import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractionType } from "@/lib/ai/extraction/types";
import type { RfpIntent } from "@/lib/ai/rfp/rfpIntentClassifier";

export interface StructuredExtractionRow {
  id: string;
  extraction_type: ExtractionType;
  page_start: number;
  page_end: number;
  title: string | null;
  discipline: string | null;
  payload: Record<string, unknown>;
  confidence: number | null;
}

function intentsToTypes(intents: RfpIntent[]): ExtractionType[] {
  const types = new Set<ExtractionType>();
  for (const intent of intents) {
    switch (intent) {
      case "quantities":
      case "equipment_inventory":
        types.add("quantity");
        types.add("schedule");
        break;
      case "materials":
        types.add("schedule");
        types.add("table");
        break;
      case "scope_of_work":
      case "quote_requirements":
        types.add("spec_section");
        break;
      default:
        break;
    }
  }
  if (types.size === 0) {
    return ["schedule", "quantity", "spec_section", "table"];
  }
  return Array.from(types);
}

function formatExtractionBlock(row: StructuredExtractionRow, fileName: string): string {
  const page =
    row.page_start === row.page_end
      ? `p. ${row.page_start}`
      : `pp. ${row.page_start}–${row.page_end}`;
  const payloadStr = JSON.stringify(row.payload, null, 2).slice(0, 2500);
  return `#### ${fileName} — ${row.extraction_type} (${page})\n${row.title ? `Title: ${row.title}\n` : ""}Confidence: ${row.confidence ?? "n/a"}\n\`\`\`json\n${payloadStr}\n\`\`\``;
}

/**
 * Load structured extractions for Copilot context.
 */
export async function loadStructuredExtractions(
  supabase: SupabaseClient,
  projectId: string,
  documentIds: string[],
  fileNamesByDocId: Record<string, string>,
  options?: { intents?: RfpIntent[]; maxItems?: number },
): Promise<string> {
  if (documentIds.length === 0) return "";

  const types = intentsToTypes(options?.intents ?? []);
  const maxItems = options?.maxItems ?? 25;

  const { data } = await supabase
    .from("document_extractions")
    .select(
      "id, document_id, extraction_type, page_start, page_end, title, discipline, payload, confidence",
    )
    .eq("project_id", projectId)
    .in("document_id", documentIds)
    .in("extraction_type", types)
    .order("confidence", { ascending: false })
    .limit(maxItems);

  if (!data?.length) return "";

  const blocks = data.map((row) =>
    formatExtractionBlock(row as StructuredExtractionRow, fileNamesByDocId[row.document_id] ?? "Document"),
  );

  return [
    "## Structured document extractions",
    "Use these pre-parsed schedules, quantities, and spec sections. Cross-check against raw chunks when needed.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}
