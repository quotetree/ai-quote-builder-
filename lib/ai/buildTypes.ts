import type { PriceBookSearchHit } from "@/lib/ai/searchPriceBook";
import type { SpreadsheetSection } from "@/types/database";

export type BuildPhase = "parse" | "auto";

export type BuildLineItemKind = "product" | "labor_lump_sum";

export interface BuildExtractedItem {
  id: string;
  kind: BuildLineItemKind;
  requestedLabel: string;
  searchQuery: string;
  quantity: number;
  unit: string;
  discountPercent: number;
  lumpSumAmount?: number;
}

export interface BuildMatchCard {
  itemId: string;
  kind: BuildLineItemKind;
  requestedLabel: string;
  quantity: number;
  unit: string;
  discountPercent: number;
  primary: PriceBookSearchHit | null;
  alternatives: PriceBookSearchHit[];
  lumpSumAmount?: number;
}

export interface BuildSpreadsheetRowInfo {
  id: string;
  customLabel: string;
  hasProduct: boolean;
}

export interface BuildSpreadsheetSectionInfo {
  id: string;
  label: string;
  filledRowCount: number;
  rows: BuildSpreadsheetRowInfo[];
}

export interface BuildSpreadsheetContext {
  id: string;
  title: string;
  sections: BuildSpreadsheetSectionInfo[];
  /** True for templates / structured sheets — show section + row placement pickers. */
  requiresPlacement: boolean;
  templateId?: string | null;
}

export interface BuildParseResponse {
  kind: "parse";
  summary: string;
  cards: BuildMatchCard[];
  spreadsheetContext?: BuildSpreadsheetContext;
  taxMarkupNotice?: string;
}

export interface BuildUpdateResponse {
  kind: "update";
  summary: string;
  updatesApplied: number;
  spreadsheetId: string;
  sections: SpreadsheetSection[];
  spreadsheetContext?: BuildSpreadsheetContext;
  taxMarkupNotice?: string;
}

export type BuildApiResponse = BuildParseResponse | BuildUpdateResponse | BuildMixedResponse;

export interface BuildMixedResponse {
  kind: "mixed";
  update: BuildUpdateResponse;
  parse: BuildParseResponse;
}

export interface BuildRequestBody {
  projectId: string;
  activeSpreadsheetId?: string | null;
  phase?: BuildPhase;
  message?: string;
}
