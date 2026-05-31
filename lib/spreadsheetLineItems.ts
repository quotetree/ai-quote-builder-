import type {
  PriceBookSearchHit,
} from "@/lib/ai/searchPriceBook";
import type { SpreadsheetRow, SpreadsheetSection } from "@/types/database";

const uid = () => crypto.randomUUID();

export function emptyRow(): SpreadsheetRow {
  return {
    id: uid(),
    custom_label: "",
    product_id: null,
    product_name: "",
    product_code: "",
    list_price: 0,
    sales_price: 0,
    discount: 0,
    quantity: 1,
  };
}

export function emptySection(label = "Untitled section"): SpreadsheetSection {
  return {
    id: uid(),
    label,
    rows: [emptyRow()],
  };
}

export function isSpreadsheetNonBlank(sections: SpreadsheetSection[]): boolean {
  return sections.some((section) =>
    (section.rows ?? []).some((row) => row.product_name?.trim()),
  );
}

export function countFilledRows(section: SpreadsheetSection): number {
  return (section.rows ?? []).filter((row) => row.product_name?.trim()).length;
}

export function rowAmount(row: SpreadsheetRow): number {
  const disc = row.discount ?? 0;
  return row.sales_price * row.quantity * (1 - disc / 100);
}

export function computeSpreadsheetTotals(sections: SpreadsheetSection[]): {
  subtotal: number;
  total: number;
} {
  const subtotal = sections.reduce(
    (sum, section) =>
      sum + (section.rows ?? []).reduce((rowSum, row) => rowSum + rowAmount(row), 0),
    0,
  );
  return { subtotal, total: subtotal };
}

export interface BuildRowInput {
  productId?: string | null;
  productName: string;
  productCode?: string;
  listPrice?: number;
  salesPrice: number;
  quantity: number;
  discount?: number;
  customLabel?: string;
}

export function buildRowFromInput(input: BuildRowInput): SpreadsheetRow {
  return {
    id: uid(),
    custom_label: input.customLabel?.trim() ?? "",
    product_id: input.productId ?? null,
    product_name: input.productName.trim(),
    product_code: input.productCode?.trim() ?? "",
    list_price: input.listPrice ?? input.salesPrice,
    sales_price: input.salesPrice,
    discount: input.discount ?? 0,
    quantity: input.quantity,
  };
}

export function buildRowFromMatch(
  hit: PriceBookSearchHit,
  quantity: number,
  discount: number,
  customLabel?: string,
): SpreadsheetRow {
  return buildRowFromInput({
    productId: hit.id,
    productName: hit.product_name,
    productCode: hit.product_number ?? "",
    listPrice: hit.list_price,
    salesPrice: hit.sales_price,
    quantity,
    discount,
    customLabel,
  });
}

/** Fill the first empty row in a section, then append if none. Keeps one trailing empty row. */
export function appendRowToSection(
  sections: SpreadsheetSection[],
  sectionId: string,
  row: SpreadsheetRow,
): SpreadsheetSection[] {
  return sections.map((section) => {
    if (section.id !== sectionId) return section;
    const rows = [...(section.rows ?? [])];
    const firstEmptyIdx = rows.findIndex((r) => !r.product_name?.trim());

    if (firstEmptyIdx >= 0) {
      rows[firstEmptyIdx] = row;
    } else {
      rows.push(row);
    }

    const last = rows[rows.length - 1];
    if (last?.product_name?.trim()) {
      rows.push(emptyRow());
    }

    return { ...section, rows };
  });
}

/** Default section: first section when spreadsheet is blank, else first section id. */
export function defaultSectionId(sections: SpreadsheetSection[]): string | null {
  return sections[0]?.id ?? null;
}

const BLANK_SECTION_LABELS = new Set(["untitled section", "line items"]);

/** Single default section with no scope categories or products filled in. */
export function isBlankSpreadsheet(sections: SpreadsheetSection[]): boolean {
  if (sections.length !== 1) return false;
  const section = sections[0];
  const label = (section.label ?? "").trim().toLowerCase();
  if (label && !BLANK_SECTION_LABELS.has(label)) return false;
  return (section.rows ?? []).every(
    (r) => !r.product_name?.trim() && !r.custom_label?.trim(),
  );
}

/** Templates and structured sheets need section + row placement before add. */
export function requiresPlacementPicker(
  sections: SpreadsheetSection[],
  templateId?: string | null,
): boolean {
  if (templateId) return true;
  if (sections.length > 1) return true;
  const hasScopeCategories = sections.some((s) =>
    (s.rows ?? []).some((r) => r.custom_label?.trim()),
  );
  if (hasScopeCategories) return true;
  if (sections.length === 1) {
    const label = (sections[0].label ?? "").trim().toLowerCase();
    if (label && !BLANK_SECTION_LABELS.has(label)) return true;
  }
  return false;
}

export function addNewSectionAtBottom(sections: SpreadsheetSection[]): SpreadsheetSection[] {
  return [...sections, emptySection("Untitled section")];
}

export interface RowProductPatch {
  productId?: string | null;
  productName: string;
  productCode?: string;
  listPrice?: number;
  salesPrice: number;
  quantity: number;
  discount?: number;
}

/** Write product fields into an existing row; preserve scope category (custom_label). */
export function fillExistingRow(
  sections: SpreadsheetSection[],
  sectionId: string,
  rowId: string,
  patch: RowProductPatch,
): SpreadsheetSection[] {
  return sections.map((section) => {
    if (section.id !== sectionId) return section;
    const rows = (section.rows ?? []).map((row) => {
      if (row.id !== rowId) return row;
      return {
        ...row,
        product_id: patch.productId ?? null,
        product_name: patch.productName.trim(),
        product_code: patch.productCode?.trim() ?? "",
        list_price: patch.listPrice ?? patch.salesPrice,
        sales_price: patch.salesPrice,
        discount: patch.discount ?? 0,
        quantity: patch.quantity,
      };
    });
    return { ...section, rows };
  });
}

export interface PlaceRowOptions {
  sectionId: string;
  rowId?: string | null;
  createNewSection?: boolean;
  createNewRow?: boolean;
  row: SpreadsheetRow;
}

export function placeRowInSpreadsheet(
  sections: SpreadsheetSection[],
  options: PlaceRowOptions,
): SpreadsheetSection[] {
  let next = sections;

  if (options.createNewSection) {
    next = addNewSectionAtBottom(next);
    const newSectionId = next[next.length - 1].id;
    return appendRowToSection(next, newSectionId, options.row);
  }

  if (options.rowId && !options.createNewRow) {
    return fillExistingRow(next, options.sectionId, options.rowId, {
      productId: options.row.product_id,
      productName: options.row.product_name,
      productCode: options.row.product_code,
      listPrice: options.row.list_price,
      salesPrice: options.row.sales_price,
      quantity: options.row.quantity,
      discount: options.row.discount,
    });
  }

  return appendRowToSection(next, options.sectionId, options.row);
}
