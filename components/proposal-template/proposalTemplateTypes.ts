export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type ElementType =
  | "text"
  | "image"
  | "attachment"
  | "signature"
  | "date"
  | "initial"
  | "checkbox"
  | "custom_variable"
  | "quote";

export interface ElementStyles {
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  align: "left" | "center" | "right";
  listType: "none" | "bullet" | "numbered";
}

export interface TemplateElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
  styles: ElementStyles;
  variableName?: string;
}

/** Sentinel value stored in TemplatePage.quoteId for placeholder pages added in the template builder. */
export const QUOTE_PLACEHOLDER_ID = "__placeholder__";

export interface TemplatePage {
  id: string;
  elements: TemplateElement[];
  /** URL of a full-page background (uploaded image or PDF page rendered to PNG) */
  backgroundImage?: string;
  /**
   * Optional override for this page's height in unscaled document pixels.
   * Used for imported image pages whose content is shorter than a full page.
   * Defaults to PAGE_HEIGHT (1056) when absent.
   */
  pageHeight?: number;
  /** When set, this page was generated from a quote PDF (used for "Change/Refresh Quote") */
  quoteId?: string;
  quoteName?: string;
  quoteNumber?: string;
}

export const DEFAULT_STYLES: ElementStyles = {
  fontSize: 14,
  fontFamily: "Arial",
  bold: false,
  italic: false,
  underline: false,
  color: "#000000",
  align: "left",
  listType: "none",
};

export const ELEMENT_LABELS: Record<ElementType, string> = {
  text: "Text Box",
  image: "Image",
  attachment: "Attachment",
  signature: "Signature",
  date: "Date",
  initial: "Initial",
  checkbox: "Checkbox",
  custom_variable: "Custom Variable",
  quote: "Quote",
};

// 736 = PAGE_WIDTH(816) minus 40px margin on each side
export const TEXT_ELEMENT_WIDTH = 736;

export const DEFAULT_ELEMENT_SIZES: Record<ElementType, { w: number; h: number }> = {
  text: { w: TEXT_ELEMENT_WIDTH, h: 40 },
  image: { w: 300, h: 200 },
  attachment: { w: TEXT_ELEMENT_WIDTH, h: 44 },
  signature: { w: 260, h: 80 },
  date: { w: 180, h: 40 },
  initial: { w: 120, h: 56 },
  checkbox: { w: 24, h: 24 },
  custom_variable: { w: 220, h: 40 },
  quote: { w: TEXT_ELEMENT_WIDTH, h: 44 },
};

// ─── Signer Color Palette ─────────────────────────────────────────────────────
// Five fixed colors assigned by position (0-indexed, cycles after 5).
// Position 0 always gets color 0, position 1 gets color 1, etc.
export const SIGNER_COLORS = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
] as const;

/** Returns the hex color for the signer at the given position in the recipients list. */
export function signerColor(index: number): string {
  return SIGNER_COLORS[index % SIGNER_COLORS.length];
}

// ─── E-Signature Recipients ───────────────────────────────────────────────────

export interface ProposalRecipient {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  role: "signer" | "cc";
}

export type ProposalSignatureStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "completed"
  | "declined"
  | "expired"
  | "failed";
