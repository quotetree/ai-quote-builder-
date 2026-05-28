export interface SheetDisciplineMapping {
  discipline: string;
  trade: string;
}

const PREFIX_MAP: Record<string, SheetDisciplineMapping> = {
  A: { discipline: "architectural", trade: "general" },
  AD: { discipline: "architectural", trade: "general" },
  AR: { discipline: "architectural", trade: "general" },
  S: { discipline: "structural", trade: "general" },
  C: { discipline: "civil", trade: "general" },
  L: { discipline: "landscape", trade: "general" },
  E: { discipline: "electrical", trade: "electrical" },
  EP: { discipline: "electrical", trade: "electrical" },
  ES: { discipline: "electrical", trade: "electrical" },
  M: { discipline: "mechanical", trade: "mechanical" },
  P: { discipline: "plumbing", trade: "plumbing" },
  FP: { discipline: "fire protection", trade: "fire_alarm" },
  FA: { discipline: "fire alarm", trade: "fire_alarm" },
  FS: { discipline: "fire alarm", trade: "fire_alarm" },
  T: { discipline: "telecom", trade: "low_voltage" },
  TE: { discipline: "telecom", trade: "low_voltage" },
  IT: { discipline: "telecom", trade: "low_voltage" },
  LV: { discipline: "low voltage", trade: "low_voltage" },
  SEC: { discipline: "security", trade: "security" },
  AV: { discipline: "audio visual", trade: "av" },
  EL: { discipline: "electrical", trade: "electrical" },
};

export function inferDisciplineFromSheetNumber(
  sheetNumber: string | null | undefined,
): SheetDisciplineMapping | null {
  if (!sheetNumber?.trim()) return null;
  const normalized = sheetNumber.trim().toUpperCase();
  const prefix = normalized.split(/[\s\-_.]/)[0] ?? normalized;
  for (const len of [3, 2, 1]) {
    const key = prefix.slice(0, len);
    if (PREFIX_MAP[key]) return PREFIX_MAP[key];
  }
  return null;
}

export function normalizeSheetNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

export const SHEET_NUMBER_IN_TEXT_RE =
  /\b([A-Z]{1,4}[\s\-_.]?\d{1,4}(?:\.\d+)?)\b/g;

export function extractSheetNumbersFromText(text: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(SHEET_NUMBER_IN_TEXT_RE.source, "gi");
  while ((match = re.exec(text)) !== null) {
    const n = normalizeSheetNumber(match[1].replace(/[\s_.]+/g, "-"));
    if (n.length >= 2 && n.length <= 12) found.add(n);
  }
  return Array.from(found);
}
