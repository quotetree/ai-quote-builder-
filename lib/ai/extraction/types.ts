export type ExtractionType =
  | "table"
  | "schedule"
  | "spec_section"
  | "quantity"
  | "entity";

export interface SchedulePayload {
  schedule_kind: "panel" | "device" | "door" | "equipment" | "unknown";
  columns: string[];
  rows: Record<string, string>[];
}

export interface SpecSectionPayload {
  section_number: string;
  title: string;
  division?: string;
  excerpt?: string;
}

export interface QuantityPayload {
  item: string;
  qty: number | null;
  unit: string | null;
  location?: string;
  raw_text: string;
}

export interface EntityPayload {
  entity_type: string;
  label: string;
  attributes: Record<string, string>;
}

export type ExtractionPayload =
  | SchedulePayload
  | SpecSectionPayload
  | QuantityPayload
  | EntityPayload
  | Record<string, unknown>;

export interface ExtractionDraft {
  extraction_type: ExtractionType;
  page_start: number;
  page_end: number;
  title: string | null;
  discipline: string | null;
  payload: ExtractionPayload;
  confidence: number;
  source_chunk_ids: string[];
}

export const EXTRACTION_VERSION = 1;

const CSI_SECTION_RE = /\b(\d{2})\s+(\d{2})\s+(\d{2})\b/;
const DIVISION_RE = /\bDIVISION\s+(\d{1,2})\b/i;

export function detectSpecSectionsInText(text: string): SpecSectionPayload[] {
  const results: SpecSectionPayload[] = [];
  const lines = text.split(/\n/);
  for (const line of lines) {
    const match = line.match(CSI_SECTION_RE);
    if (!match) continue;
    const section_number = `${match[1]} ${match[2]} ${match[3]}`;
    const title = line.replace(CSI_SECTION_RE, "").replace(/^[\s\-–:]+/, "").trim();
    results.push({
      section_number,
      title: title || section_number,
      division: match[1],
      excerpt: line.trim(),
    });
  }
  const divMatch = text.match(DIVISION_RE);
  if (divMatch && results.length === 0) {
    results.push({
      section_number: `Division ${divMatch[1]}`,
      title: divMatch[0],
      division: divMatch[1],
    });
  }
  return results.slice(0, 5);
}

export function detectQuantitiesInText(text: string, pageStart: number): QuantityPayload[] {
  const results: QuantityPayload[] = [];
  const lineRe =
    /(\d{1,5})\s+(each|ea|units?|pcs?|lot|ls|lf|sf|sy)\b[^\n]{0,80}/gi;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(text)) !== null && results.length < 20) {
    results.push({
      item: match[0].trim().slice(0, 120),
      qty: parseInt(match[1], 10),
      unit: match[2],
      raw_text: match[0].trim(),
    });
  }
  if (results.length === 0 && /\bqty\b|\bquantity\b/i.test(text)) {
    results.push({
      item: `Page ${pageStart} quantity block`,
      qty: null,
      unit: null,
      raw_text: text.slice(0, 500),
    });
  }
  return results;
}
