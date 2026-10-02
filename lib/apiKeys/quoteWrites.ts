import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuoteCreateInput, QuoteUpdateInput } from "./quoteInput.ts";
import { projectV1Quote, type V1QuoteWithItems } from "./v1Quote.ts";
import type { QuoteTotals } from "../quote/totals.ts";
import { SPREADSHEET_QUOTE_SCOPE } from "../spreadsheetFromQuote.ts";

/**
 * Quote writes bound to one API key and its organization. Each operation is a
 * database function that filters on that organization itself, so a caller
 * cannot name another organization's rows, and that records the write in
 * `api_key_audit` in the same transaction.
 */
export type QuoteWrites = {
  createQuote(input: QuoteCreateInput, totals: QuoteTotals): Promise<WriteResult>;
  updateQuote(
    id: string,
    input: QuoteUpdateInput,
    totals: QuoteTotals | null,
    sheetSections: unknown | null
  ): Promise<WriteResult>;
  deleteQuote(id: string): Promise<{ status: "ok" | "not_found" }>;
};

export type WriteResult =
  | { status: "ok"; quote: V1QuoteWithItems }
  | { status: "not_found" | "locked" | "too_large" };

type QuoteFunctionResult =
  | { status: "ok"; quote: Record<string, unknown>; items: Record<string, unknown>[] }
  | { status: "not_found" | "locked" | "too_large" };

type WriteAction = "create" | "update" | "delete";

const FAILURE_STATUSES: readonly unknown[] = ["not_found", "locked", "too_large"];

// One structured line per keyed write. Never include the presented key.
function logWrite(entry: {
  keyId: string;
  organizationId: string;
  action: WriteAction;
  quoteId: string | null;
  outcome: string;
}) {
  console.log("[api-keys] write", JSON.stringify(entry));
}

/**
 * Builds the quote write operations for one authenticated API key.
 *
 * @param svc - Service-role client. RLS does not apply to it, so every write
 *   goes through a database function that pins the organization.
 * @param key - The key's id, recorded on each audit row, and its organization.
 * @returns Create, update and delete operations scoped to that organization.
 */
export function createQuoteWrites(
  svc: Pick<SupabaseClient, "rpc">,
  { keyId, organizationId }: { keyId: string; organizationId: string }
): QuoteWrites {
  // Logs the outcome of a create or update function call and maps it to a WriteResult.
  // quoteId is the target for an update, and null for a create until it succeeds.
  function settleQuoteFunction(
    action: "create" | "update",
    quoteId: string | null,
    data: unknown,
    rpcError: unknown
  ): WriteResult {
    if (rpcError) {
      logWrite({ keyId, organizationId, action, quoteId, outcome: "error" });
      throw rpcError;
    }

    const result = data as QuoteFunctionResult;
    if (result?.status === "ok") {
      const quote = projectV1Quote(result.quote, result.items);
      logWrite({ keyId, organizationId, action, quoteId: String(result.quote.id), outcome: "ok" });
      return { status: "ok", quote };
    }

    if (!FAILURE_STATUSES.includes(result?.status)) {
      logWrite({ keyId, organizationId, action, quoteId, outcome: "error" });
      throw new Error(`Quote ${action} function returned an unrecognized status: ${result?.status}`);
    }

    logWrite({ keyId, organizationId, action, quoteId, outcome: result.status });
    return { status: result.status };
  }

  return {
    async createQuote(input, totals) {
      const { data, error: rpcError } = await svc.rpc("api_create_quote", {
        p_organization_id: organizationId,
        p_key_id: keyId,
        p_project_id: input.project_id,
        p_quote_name: input.quote_name,
        p_status: input.status,
        p_expiration_date: input.expiration_date,
        // Marks the quote so the app reopens it in the spreadsheet editor
        p_scope_of_work: SPREADSHEET_QUOTE_SCOPE,
        p_items: totals.items,
        p_subtotal: totals.subtotal,
      });
      return settleQuoteFunction("create", null, data, rpcError);
    },

    async updateQuote(id, input, totals, sheetSections) {
      // Only the fields the request sent, so the function leaves the others as stored
      const p_fields: Record<string, string> = {};
      if (input.quote_name !== undefined) p_fields.quote_name = input.quote_name;
      if (input.status !== undefined) p_fields.status = input.status;
      if (input.expiration_date !== undefined) p_fields.expiration_date = input.expiration_date;

      const { data, error: rpcError } = await svc.rpc("api_update_quote", {
        p_organization_id: organizationId,
        p_key_id: keyId,
        p_quote_id: id,
        p_fields,
        p_items: totals?.items ?? null,
        p_subtotal: totals?.subtotal ?? null,
        p_sheet_sections: sheetSections,
      });
      return settleQuoteFunction("update", id, data, rpcError);
    },

    async deleteQuote(id) {
      const { data, error: rpcError } = await svc.rpc("api_delete_quote", {
        p_organization_id: organizationId,
        p_key_id: keyId,
        p_quote_id: id,
      });

      if (rpcError) {
        logWrite({ keyId, organizationId, action: "delete", quoteId: id, outcome: "error" });
        throw rpcError;
      }

      const status = (data as { status?: unknown } | null)?.status;
      if (status !== "ok" && status !== "not_found") {
        logWrite({ keyId, organizationId, action: "delete", quoteId: id, outcome: "error" });
        throw new Error(`Quote delete function returned an unrecognized status: ${status}`);
      }

      logWrite({ keyId, organizationId, action: "delete", quoteId: id, outcome: status });
      return { status };
    },
  };
}
