import { getServiceClient } from "@/lib/supabase/service";
import { classifyKeyLookup, extractPresentedKey, hashApiKey } from "./token";
import type { ApiKeyPermission } from "./permissions";
import { createQuoteWrites, type QuoteWrites } from "./quoteWrites";

/**
 * Starts a query on a table already filtered to the key's organization. Only
 * valid for tables that carry an `organization_id` column; read child tables
 * through their parent.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ScopedQuery = (table: string, columns?: string) => any;

export type ApiKeyAuth =
  | {
      ok: true;
      organizationId: string;
      permissions: ApiKeyPermission[];
      scoped: ScopedQuery;
      writes: QuoteWrites;
    }
  | { ok: false; status: number; error: string };

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

  return {
    ok: true,
    organizationId,
    // The column's CHECK constraint guarantees only known grants are stored
    permissions: (row!.permissions ?? []) as ApiKeyPermission[],
    scoped: (table, columns = "*") =>
      svc.from(table).select(columns).eq("organization_id", organizationId),
    writes: createQuoteWrites(svc, { keyId: row!.id, organizationId }),
  };
}
