import type { SpreadsheetRow, SpreadsheetSection } from "@/types/database";

export type BuildUpdateOpType =
  | "set_discount"
  | "set_quantity"
  | "adjust_quantity"
  | "set_sales_price"
  | "adjust_sales_price";

export interface BuildUpdateTarget {
  /** Match all rows with a product in the spreadsheet */
  scope: "all" | "section" | "product";
  /** Fuzzy section header match, e.g. "Equipment" */
  sectionLabel?: string;
  /** Keywords matched against product name, code, and scope category */
  productKeywords?: string[];
}

export interface BuildUpdateInstruction {
  op: BuildUpdateOpType;
  target: BuildUpdateTarget;
  discountPercent?: number;
  quantity?: number;
  delta?: number;
  salesPrice?: number;
  description?: string;
}

export interface BuildExplicitAdd {
  requestedLabel: string;
  searchQuery: string;
  quantity: number;
  unit: string;
  discountPercent: number;
  kind: "product" | "labor_lump_sum";
  lumpSumAmount?: number;
}

export interface BuildAnalyzeResult {
  intent: "add" | "update" | "mixed";
  updates: BuildUpdateInstruction[];
  explicitAdds: BuildExplicitAdd[];
  taxOrMarkupRequested: boolean;
  taxMarkupSummary?: string;
}

export interface AppliedBuildUpdate {
  sectionLabel: string;
  productName: string;
  customLabel: string;
  field: string;
  oldValue: number;
  newValue: number;
  description?: string;
}

export interface BuildUpdateProposal {
  proposalId: string;
  sectionId: string;
  rowId: string;
  productName: string;
  sectionLabel: string;
  customLabel: string;
  field: string;
  oldValue: number;
  newValue: number;
  description?: string;
  instruction: BuildUpdateInstruction;
}

export function formatSpreadsheetLinesForPrompt(sections: SpreadsheetSection[]): string {
  const lines: string[] = [];
  for (const section of sections ?? []) {
    lines.push(`## Section: ${section.label || "Untitled"}`);
    for (const row of section.rows ?? []) {
      if (!row.product_name?.trim()) continue;
      const label = row.custom_label?.trim() ? ` | Scope category: ${row.custom_label}` : "";
      lines.push(
        `- Product: ${row.product_name}${label} | Qty: ${row.quantity ?? 0} | Discount: ${row.discount ?? 0}% | Sales price: $${row.sales_price ?? 0}`,
      );
    }
  }
  if (lines.length === 0) return "(No line items with products yet)";
  return lines.join("\n");
}

const GENERIC_MATCH_TERMS = new Set([
  "labor",
  "labour",
  "service",
  "services",
  "installation",
  "work",
  "total",
]);

function normalizeTerms(keywords: string[]): string[] {
  return keywords
    .flatMap((k) => k.toLowerCase().split(/\s+/))
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 1);
}

function rowMatchesProduct(row: SpreadsheetRow, keywords: string[]): boolean {
  if (!row.product_name?.trim()) return false;
  const allTerms = normalizeTerms(keywords);
  if (allTerms.length === 0) return false;

  const distinctive = allTerms.filter((t) => !GENERIC_MATCH_TERMS.has(t));
  const text = rowSearchText(row).replace(/[^a-z0-9\s]/g, " ");

  if (distinctive.length === 0) {
    const phrase = allTerms.join(" ");
    return text.includes(phrase);
  }

  return distinctive.every((t) => text.includes(t));
}

function sectionMatchesLabel(section: SpreadsheetSection, label: string): boolean {
  const a = (section.label ?? "").trim().toLowerCase();
  const b = label.trim().toLowerCase();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function collectTargetRows(
  sections: SpreadsheetSection[],
  target: BuildUpdateTarget,
): Array<{ section: SpreadsheetSection; row: SpreadsheetRow }> {
  const hits: Array<{ section: SpreadsheetSection; row: SpreadsheetRow }> = [];

  for (const section of sections) {
    if (target.scope === "section" && target.sectionLabel) {
      if (!sectionMatchesLabel(section, target.sectionLabel)) continue;
    }

    for (const row of section.rows ?? []) {
      if (!row.product_name?.trim()) continue;

      if (target.scope === "all") {
        hits.push({ section, row });
        continue;
      }
      if (target.scope === "section") {
        hits.push({ section, row });
        continue;
      }
      if (target.scope === "product" && target.productKeywords?.length) {
        if (rowMatchesProduct(row, target.productKeywords)) {
          hits.push({ section, row });
        }
      }
    }
  }

  return hits;
}

function rowSearchText(row: SpreadsheetRow): string {
  return [row.product_name, row.product_code, row.custom_label]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function computeUpdateValues(
  current: SpreadsheetRow,
  update: BuildUpdateInstruction,
): { field: string; oldValue: number; newValue: number; patch: Partial<SpreadsheetRow> } | null {
  let field = "";
  let oldValue = 0;
  let newValue = 0;
  const patch: Partial<SpreadsheetRow> = {};

  switch (update.op) {
    case "set_discount": {
      oldValue = current.discount ?? 0;
      newValue = Math.min(100, Math.max(0, update.discountPercent ?? oldValue));
      patch.discount = newValue;
      field = "discount %";
      break;
    }
    case "set_quantity": {
      oldValue = current.quantity ?? 0;
      newValue = Math.max(0, update.quantity ?? oldValue);
      patch.quantity = newValue;
      field = "quantity";
      break;
    }
    case "adjust_quantity": {
      oldValue = current.quantity ?? 0;
      newValue = Math.max(0, oldValue + (update.delta ?? 0));
      patch.quantity = newValue;
      field = "quantity";
      break;
    }
    case "set_sales_price": {
      oldValue = current.sales_price ?? 0;
      newValue = Math.max(0, update.salesPrice ?? oldValue);
      patch.sales_price = newValue;
      field = "sales price";
      break;
    }
    case "adjust_sales_price": {
      oldValue = current.sales_price ?? 0;
      newValue = Math.max(0, oldValue + (update.delta ?? 0));
      patch.sales_price = newValue;
      field = "sales price";
      break;
    }
    default:
      return null;
  }

  if (oldValue === newValue) return null;
  return { field, oldValue, newValue, patch };
}

export function previewBuildUpdates(
  sections: SpreadsheetSection[],
  updates: BuildUpdateInstruction[],
): BuildUpdateProposal[] {
  const proposals: BuildUpdateProposal[] = [];

  for (const update of updates) {
    const targets = collectTargetRows(sections, update.target);
    for (const { section, row } of targets) {
      const computed = computeUpdateValues(row, update);
      if (!computed) continue;

      proposals.push({
        proposalId: crypto.randomUUID(),
        sectionId: section.id,
        rowId: row.id,
        productName: row.product_name,
        sectionLabel: section.label || "Section",
        customLabel: row.custom_label ?? "",
        field: computed.field,
        oldValue: computed.oldValue,
        newValue: computed.newValue,
        description: update.description,
        instruction: update,
      });
    }
  }

  return proposals;
}

export function applyBuildUpdates(
  sections: SpreadsheetSection[],
  updates: BuildUpdateInstruction[],
): { sections: SpreadsheetSection[]; applied: AppliedBuildUpdate[] } {
  let next = sections.map((s) => ({ ...s, rows: [...(s.rows ?? [])] }));
  const applied: AppliedBuildUpdate[] = [];

  for (const update of updates) {
    const targets = collectTargetRows(next, update.target);
    if (targets.length === 0) continue;

    for (const { section, row } of targets) {
      const sectionIdx = next.findIndex((s) => s.id === section.id);
      const rowIdx = next[sectionIdx].rows.findIndex((r) => r.id === row.id);
      if (sectionIdx < 0 || rowIdx < 0) continue;

      const current = next[sectionIdx].rows[rowIdx];
      const computed = computeUpdateValues(current, update);
      if (!computed) continue;

      const { field, oldValue, newValue, patch } = computed;
      next[sectionIdx].rows[rowIdx] = { ...current, ...patch };
      applied.push({
        sectionLabel: section.label || "Section",
        productName: current.product_name,
        customLabel: current.custom_label ?? "",
        field,
        oldValue,
        newValue,
        description: update.description,
      });
    }
  }

  return { sections: next, applied };
}

export function applyBuildUpdateProposals(
  sections: SpreadsheetSection[],
  proposals: BuildUpdateProposal[],
): { sections: SpreadsheetSection[]; applied: AppliedBuildUpdate[] } {
  const instructions = proposals.map((p) => p.instruction);
  return applyBuildUpdates(sections, instructions);
}

export function summarizeAppliedUpdates(applied: AppliedBuildUpdate[]): string {
  if (applied.length === 0) {
    return "I couldn't find any matching line items to update. Check product names or section labels and try again.";
  }

  const lines = applied.slice(0, 12).map((a) => {
    const label = a.customLabel ? `"${a.customLabel}" — ` : "";
    return `- ${label}**${a.productName}** (${a.sectionLabel}): ${a.field} ${a.oldValue} → ${a.newValue}`;
  });

  const extra =
    applied.length > 12 ? `\n\n_…and ${applied.length - 12} more row change(s)._` : "";

  return `Applied **${applied.length}** line item change(s) on your spreadsheet:\n\n${lines.join("\n")}${extra}`;
}

export function summarizeUpdateProposals(proposals: BuildUpdateProposal[]): string {
  if (proposals.length === 0) return "";
  const lines = proposals.slice(0, 12).map((p) => {
    const label = p.customLabel ? `"${p.customLabel}" — ` : "";
    return `- ${label}**${p.productName}** (${p.sectionLabel}): ${p.field} ${p.oldValue} → ${p.newValue}`;
  });
  const extra =
    proposals.length > 12 ? `\n\n_…and ${proposals.length - 12} more proposed change(s)._` : "";
  return `Proposed **${proposals.length}** change(s) to existing line items — review and click **Apply** to confirm:\n\n${lines.join("\n")}${extra}`;
}
