import { getServiceClient } from "@/lib/supabase/service";
import { classifyKeyLookup, extractPresentedKey, hashApiKey } from "./token";
import type { ApiKeyPermission } from "./permissions";
import type { QuoteCreateInput, QuoteUpdateInput } from "./quoteInput";
import { projectV1Quote, type V1QuoteWithItems } from "./v1Quote";
import type { QuoteTotals } from "@/lib/quote/totals";

/**
 * Starts a query on a table already filtered to the key's organization. Only
 * valid for tables that carry an `organization_id` column; read child tables
 * through their parent.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ScopedQuery = (table: string, columns?: string) => any;

/**
 * Quote writes bound to the key's organization. Each operation filters on that
 * organization itself, so a caller cannot name another organization's rows.
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

const FAILURE_STATUSES: readonly unknown[] = ["not_found", "locked", "too_large"];

export type ApiKeyAuth =
  | {
      ok: true;
      organizationId: string;
      permissions: ApiKeyPermission[];
      scoped: ScopedQuery;
      writes: QuoteWrites;
    }
  | { ok: false; status: number; error: string };

// One structured line per keyed write. Never include the presented key.
function logWrite(entry: {
  keyId: string;
  organizationId: string;
  action: string;
  quoteId: string | null;
  outcome: string;
}) {
  console.log("[api-keys] write", JSON.stringify(entry));
}

/**
 * Authenticates a request by its API key and binds it to the key's organization.
 *
 * The organization is derived from the key hash, never from request input, and
 * the caller receives only pre-filtered read handles and write operations bound
 * to the key's organization. This is the single tenant-isolation point for
 * key-authenticated requests, since RLS does not apply to the service-role
 * client.
 */
export async function authenticateApiKey(request: Request): Promise<ApiKeyAuth> {
  const presented = extractPresentedKey(request.headers);
  if (!presented.ok) return presented;

  const svc = getServiceClient();
  const { data: row, error } = await svc
    .from("organization_api_keys")
    .select("id, organization_id, revoked_at, permissions")
    .eq("key_hash", hashApiKey(presented.key))
    .maybeSingle();

  const classified = classifyKeyLookup({ row, error });
  if (!classified.ok) return classified;

  const { organizationId } = classified;

  // Best-effort activity stamp; a failed write must never fail the request
  void svc
    .from("organization_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row!.id)
    .then(({ error: stampError }: { error: unknown }) => {
      if (stampError) console.error("Failed to stamp API key last_used_at:", stampError);
    });

  const keyId: string = row!.id;

  // Logs the outcome of a quote function call and maps it to a WriteResult.
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

  const writes: QuoteWrites = {
    async createQuote(input, totals) {
      const { data, error: rpcError } = await svc.rpc("api_create_quote", {
        p_organization_id: organizationId,
        p_project_id: input.project_id,
        p_quote_name: input.quote_name,
        p_status: input.status,
        p_expiration_date: input.expiration_date,
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
        p_quote_id: id,
        p_fields,
        p_items: totals?.items ?? null,
        p_subtotal: totals?.subtotal ?? null,
        p_sheet_sections: sheetSections,
      });
      return settleQuoteFunction("update", id, data, rpcError);
    },

    async deleteQuote(id) {
      // Cascades remove the quote's items, profit overrides, proposal and signatures
      const { data, error: deleteError } = await svc
        .from("quotes")
        .delete()
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select("id");

      if (deleteError) {
        logWrite({ keyId, organizationId, action: "delete", quoteId: id, outcome: "error" });
        throw deleteError;
      }

      const status = data && data.length > 0 ? "ok" : "not_found";
      logWrite({ keyId, organizationId, action: "delete", quoteId: id, outcome: status });
      return { status };
    },
  };

  return {
    ok: true,
    organizationId,
    // The column's CHECK constraint guarantees only known grants are stored
    permissions: (row!.permissions ?? []) as ApiKeyPermission[],
    scoped: (table, columns = "*") =>
      svc.from(table).select(columns).eq("organization_id", organizationId),
    writes,
  };
}
