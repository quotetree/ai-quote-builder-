import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractSheetNumbersFromText,
  inferDisciplineFromSheetNumber,
} from "@/lib/ai/plan/sheetDiscipline";

export interface SheetIndexRow {
  document_id: string;
  sheet_number: string;
  sheet_title: string | null;
  discipline: string | null;
  trade: string | null;
  page_number: number;
  revision: string | null;
  confidence: number | null;
}

export interface SheetIndexContext {
  promptText: string;
  pageNumbersByDocument: Record<string, number[]>;
  sheetNumbers: string[];
}

function parseTradeFilter(message: string): string | null {
  const lower = message.toLowerCase();
  if (/\bfire alarm\b|\bfa sheets?\b/.test(lower)) return "fire_alarm";
  if (/\belectrical\b|\b(?:^|\s)e[\s-]?\d/.test(lower)) return "electrical";
  if (/\bsecurity\b|\baccess control\b/.test(lower)) return "security";
  if (/\blow voltage\b|\bstructured cabling\b|\btelecom\b/.test(lower)) return "low_voltage";
  if (/\bmechanical\b/.test(lower)) return "mechanical";
  return null;
}

/**
 * Load sheet index for Copilot context and retrieval filtering.
 */
export async function loadSheetIndexContext(
  supabase: SupabaseClient,
  projectId: string,
  documentIds: string[],
  userMessage?: string,
): Promise<SheetIndexContext> {
  if (documentIds.length === 0) {
    return { promptText: "", pageNumbersByDocument: {}, sheetNumbers: [] };
  }

  let query = supabase
    .from("document_sheet_index")
    .select(
      "document_id, sheet_number, sheet_title, discipline, trade, page_number, revision, confidence",
    )
    .eq("project_id", projectId)
    .in("document_id", documentIds)
    .order("sheet_number", { ascending: true });

  const tradeFilter = userMessage ? parseTradeFilter(userMessage) : null;
  if (tradeFilter) {
    query = query.eq("trade", tradeFilter);
  }

  const citedSheets = userMessage ? extractSheetNumbersFromText(userMessage) : [];
  const { data: rows } = await query.limit(120);

  if (!rows?.length) {
    return { promptText: "", pageNumbersByDocument: {}, sheetNumbers: citedSheets };
  }

  const { data: docs } = await supabase
    .from("project_documents")
    .select("id, file_name")
    .in("id", documentIds);
  const names: Record<string, string> = {};
  for (const d of docs ?? []) names[d.id] = d.file_name;

  const pageNumbersByDocument: Record<string, number[]> = {};
  const lines: string[] = [];

  for (const row of rows as SheetIndexRow[]) {
    const fileName = names[row.document_id] ?? "Document";
    lines.push(
      `- **${row.sheet_number}** — ${row.sheet_title ?? "(no title)"} | ${fileName} p.${row.page_number}${row.trade ? ` | trade: ${row.trade}` : ""}`,
    );
    if (!pageNumbersByDocument[row.document_id]) {
      pageNumbersByDocument[row.document_id] = [];
    }
    pageNumbersByDocument[row.document_id].push(row.page_number);
  }

  for (const sheet of citedSheets) {
    const match = rows.find((r) => r.sheet_number.toUpperCase() === sheet.toUpperCase());
    if (match && !pageNumbersByDocument[match.document_id]?.includes(match.page_number)) {
      pageNumbersByDocument[match.document_id] = pageNumbersByDocument[match.document_id] ?? [];
      pageNumbersByDocument[match.document_id].push(match.page_number);
    }
  }

  const promptText = [
    "## Plan sheet index",
    "Use this index to answer questions about drawing sheets, disciplines, and trades.",
    tradeFilter ? `(Filtered to trade: ${tradeFilter})` : "",
    "",
    lines.join("\n"),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    promptText,
    pageNumbersByDocument,
    sheetNumbers: [...citedSheets, ...rows.map((r) => r.sheet_number)],
  };
}

export async function loadProjectSheetIndexSummary(
  supabase: SupabaseClient,
  projectId: string,
  limit = 40,
): Promise<string> {
  const { data } = await supabase
    .from("document_sheet_index")
    .select("sheet_number, sheet_title, trade, page_number, document_id")
    .eq("project_id", projectId)
    .order("sheet_number", { ascending: true })
    .limit(limit);

  if (!data?.length) return "";

  const lines = data.map(
    (r) => `- ${r.sheet_number}: ${r.sheet_title ?? "—"} (p.${r.page_number}${r.trade ? `, ${r.trade}` : ""})`,
  );
  return `## Project plan sheet index (sample)\n${lines.join("\n")}`;
}

export { inferDisciplineFromSheetNumber, extractSheetNumbersFromText };
