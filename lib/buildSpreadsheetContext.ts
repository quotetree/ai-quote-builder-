import type { BuildSpreadsheetContext } from "@/lib/ai/buildTypes";
import {
  countFilledRows,
  requiresPlacementPicker,
} from "@/lib/spreadsheetLineItems";
import type { SpreadsheetSection } from "@/types/database";

export function buildSpreadsheetContext(
  id: string,
  title: string,
  sections: SpreadsheetSection[],
  templateId?: string | null,
): BuildSpreadsheetContext {
  return normalizeSpreadsheetContext({
    id,
    title: title || "Untitled Spreadsheet",
    templateId: templateId ?? null,
    requiresPlacement: requiresPlacementPicker(sections, templateId),
    sections: sections.map((s) => ({
      id: s.id,
      label: s.label || "Section",
      filledRowCount: countFilledRows(s),
      rows: (s.rows ?? []).map((r) => ({
        id: r.id,
        customLabel: r.custom_label?.trim() ?? "",
        hasProduct: Boolean(r.product_name?.trim()),
      })),
    })),
  });
}

/** Ensure sections always have a rows array (legacy chat metadata may omit it). */
export function normalizeSpreadsheetContext(
  ctx: BuildSpreadsheetContext & { isNonBlank?: boolean },
): BuildSpreadsheetContext {
  const requiresPlacement =
    typeof ctx.requiresPlacement === "boolean"
      ? ctx.requiresPlacement
      : Boolean(ctx.isNonBlank);

  return {
    id: ctx.id,
    title: ctx.title || "Untitled Spreadsheet",
    templateId: ctx.templateId ?? null,
    requiresPlacement,
    sections: (ctx.sections ?? []).map((s) => ({
      id: s.id,
      label: s.label || "Section",
      filledRowCount: s.filledRowCount ?? 0,
      rows: (s.rows ?? []).map((r) => ({
        id: r.id,
        customLabel: r.customLabel?.trim() ?? "",
        hasProduct: Boolean(r.hasProduct),
      })),
    })),
  };
}
