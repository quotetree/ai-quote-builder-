import type { SupabaseClient } from "@supabase/supabase-js";

export const QUOTE_SPREADSHEET_NAME_SYNCED = "quoteSpreadsheetNameSynced";

export type QuoteSpreadsheetNameSyncDetail = {
  name: string;
  spreadsheetId?: string | null;
  quoteId?: string | null;
  projectId?: string | null;
};

/** Notify Log / Drive / open editors that a linked quote↔spreadsheet name changed. */
export function dispatchQuoteSpreadsheetNameSynced(
  detail: QuoteSpreadsheetNameSyncDetail,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(QUOTE_SPREADSHEET_NAME_SYNCED, { detail }),
  );
}

/** After a quote rename: push the new name onto its linked spreadsheet (if any). */
export async function syncSpreadsheetTitleFromQuote(
  supabase: SupabaseClient,
  opts: {
    quoteId: string;
    spreadsheetId: string | null | undefined;
    name: string;
    projectId?: string | null;
  },
): Promise<void> {
  const name = opts.name.trim();
  if (!name || !opts.spreadsheetId) return;

  const { error } = await supabase
    .from("project_spreadsheets")
    .update({ title: name })
    .eq("id", opts.spreadsheetId);

  if (error) {
    console.error("Failed to sync spreadsheet title from quote rename:", error);
    return;
  }

  dispatchQuoteSpreadsheetNameSynced({
    name,
    spreadsheetId: opts.spreadsheetId,
    quoteId: opts.quoteId,
    projectId: opts.projectId ?? null,
  });
}

/** After a spreadsheet rename/save: push the new title onto all linked quotes. */
export async function syncQuoteNamesFromSpreadsheet(
  supabase: SupabaseClient,
  opts: {
    spreadsheetId: string;
    name: string;
    projectId?: string | null;
  },
): Promise<void> {
  const name = opts.name.trim();
  if (!name) return;

  const { data, error } = await supabase
    .from("quotes")
    .update({ quote_name: name })
    .eq("spreadsheet_id", opts.spreadsheetId)
    .select("id");

  if (error) {
    console.error("Failed to sync quote name from spreadsheet rename:", error);
    return;
  }

  if (!data?.length) return;

  dispatchQuoteSpreadsheetNameSynced({
    name,
    spreadsheetId: opts.spreadsheetId,
    quoteId: data.length === 1 ? data[0].id : null,
    projectId: opts.projectId ?? null,
  });
}
