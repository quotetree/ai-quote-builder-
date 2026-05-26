import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ProjectSpreadsheet,
  Quote,
  QuoteItem,
  SpreadsheetRow,
  SpreadsheetSection,
} from "@/types/database";

export const SPREADSHEET_QUOTE_SCOPE = "Generated from spreadsheet";

const uid = () => crypto.randomUUID();

const emptyRow = (): SpreadsheetRow => ({
  id: uid(),
  custom_label: "",
  product_id: null,
  product_name: "",
  product_code: "",
  list_price: 0,
  sales_price: 0,
  discount: 0,
  quantity: 1,
});

const emptySection = (label = "Line Items"): SpreadsheetSection => ({
  id: uid(),
  label,
  rows: [emptyRow()],
});

/** Quotes created from (or linked to) a spreadsheet should reopen in the spreadsheet editor. */
export function isSpreadsheetSourcedQuote(quote: {
  spreadsheet_id?: string | null;
  scope_of_work?: string | null;
}): boolean {
  return Boolean(
    quote.spreadsheet_id || quote.scope_of_work === SPREADSHEET_QUOTE_SCOPE,
  );
}

function discountPercentForSpreadsheet(raw: number | null | undefined): number {
  const value = raw ?? 0;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1 ? value : value * 100;
}

export function quoteItemsToSpreadsheetSections(
  items: QuoteItem[] = [],
): SpreadsheetSection[] {
  if (items.length === 0) return [emptySection()];

  const sorted = [...items].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );

  return [
    {
      id: uid(),
      label: "Line Items",
      rows: sorted.map((item) => ({
        id: uid(),
        custom_label: "",
        product_id: item.product_id,
        product_name: item.product_name,
        product_code: item.product_number || "",
        list_price:
          item.list_price ??
          item.product?.list_price ??
          item.unit_price ??
          0,
        sales_price: item.unit_price,
        discount: discountPercentForSpreadsheet(item.discount_percent),
        quantity: item.quantity > 0 ? item.quantity : 1,
      })),
    },
  ];
}

type QuoteWithItems = Quote & {
  items?: QuoteItem[];
  baked_markups?: unknown;
  bakedMarkups?: unknown;
};

/**
 * Returns the spreadsheet linked to a quote, creating a new one from quote data
 * when the previous spreadsheet was deleted.
 */
export async function ensureSpreadsheetForQuote(
  supabase: SupabaseClient,
  quoteId: string,
): Promise<ProjectSpreadsheet> {
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      `
      *,
      items:quote_items(
        *,
        product:products!quote_items_product_id_fkey(
          id,
          product_name,
          list_price,
          cost_price
        )
      )
    `,
    )
    .eq("id", quoteId)
    .single();

  if (quoteError || !quote) {
    throw new Error("Quote not found");
  }

  const typedQuote = quote as QuoteWithItems;

  if (typedQuote.spreadsheet_id) {
    const { data: existing, error: sheetError } = await supabase
      .from("project_spreadsheets")
      .select("*")
      .eq("id", typedQuote.spreadsheet_id)
      .single();

    if (!sheetError && existing) {
      return existing as ProjectSpreadsheet;
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const bakedMarkups =
    typedQuote.baked_markups ?? typedQuote.bakedMarkups ?? [];
  const charges = typedQuote.charges ?? [];

  const { data: newSheet, error: insertError } = await supabase
    .from("project_spreadsheets")
    .insert({
      project_id: typedQuote.project_id,
      user_id: user.id,
      folder_id: null,
      title: typedQuote.quote_name || "Untitled Spreadsheet",
      template_id: null,
      sections: quoteItemsToSpreadsheetSections(typedQuote.items),
      charges,
      baked_markups: bakedMarkups,
      subtotal: typedQuote.subtotal ?? 0,
      total: typedQuote.total_price ?? 0,
    })
    .select()
    .single();

  if (insertError || !newSheet) {
    throw insertError ?? new Error("Failed to create spreadsheet");
  }

  const { error: linkError } = await supabase
    .from("quotes")
    .update({ spreadsheet_id: newSheet.id })
    .eq("id", quoteId);

  if (linkError) throw linkError;

  return newSheet as ProjectSpreadsheet;
}
