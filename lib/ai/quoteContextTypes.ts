import type { SpreadsheetSection } from "@/types/database";

/** One line item sent to the model (pricing is reference-only). */
export interface QuoteContextLineItem {
  sectionLabel: string;
  label: string;
  productName: string;
  productCode: string;
  quantity: number;
  salesPrice: number;
  listPrice: number;
  discountPercent: number;
}

export interface QuoteContextSpreadsheetSummary {
  id: string;
  title: string;
  rowCount: number;
  sectionCount: number;
  subtotal: number;
  total: number;
}

export interface QuoteContextActiveSpreadsheet extends QuoteContextSpreadsheetSummary {
  sections: SpreadsheetSection[];
  lineItems: QuoteContextLineItem[];
  lineItemsTruncated: boolean;
}

export interface QuoteContextQuoteSummary {
  id: string;
  quoteName: string;
  quoteNumber: string;
  versionNumber: number;
  status: string;
  spreadsheetId: string | null;
  itemCount: number;
  totalPrice: number;
  scopePreview: string | null;
}

export interface QuoteContextResult {
  projectId: string;
  projectName: string;
  productFamilies: string[];
  activeSpreadsheet: QuoteContextActiveSpreadsheet | null;
  spreadsheetSummaries: QuoteContextSpreadsheetSummary[];
  recentQuotes: QuoteContextQuoteSummary[];
  /** Human-readable block for LLM prompts (Phase 3+). */
  promptText: string;
  stats: {
    spreadsheetCount: number;
    activeLineItemCount: number;
    recentQuoteCount: number;
  };
}
