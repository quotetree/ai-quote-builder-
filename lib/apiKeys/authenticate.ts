import { getServiceClient } from "@/lib/supabase/service";
import { classifyKeyLookup, extractPresentedKey, hashApiKey } from "./token";

/**
 * Starts a query on a table already filtered to the key's organization. Only
 * valid for tables that carry an `organization_id` column; read child tables
 * through their parent.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ScopedQuery = (table: string, columns?: string) => any;

export type ApiKeyAuth =
  | { ok: true; organizationId: string; scoped: ScopedQuery }
  | { ok: false; status: number; error: string };

/**
 * Authenticates a request by its API key and binds it to the key's organization.
 *
 * The organization is derived from the key hash, never from request input, and
 * the caller receives only pre-filtered query handles. This is the single
 * tenant-isolation point for key-authenticated requests, since RLS does not
 * apply to the service-role client.
 */
export async function authenticateApiKey(request: Request): Promise<ApiKeyAuth> {
  const presented = extractPresentedKey(request.headers);
  if (!presented.ok) return presented;

  const svc = getServiceClient();
  const { data: row, error } = await svc
    .from("organization_api_keys")
    .select("id, organization_id, revoked_at")
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
    scoped: (table, columns = "*") =>
      svc.from(table).select(columns).eq("organization_id", organizationId),
  };
}
