export const API_KEY_PERMISSIONS = ["quotes:create", "quotes:update", "quotes:delete"] as const;

export type ApiKeyPermission = (typeof API_KEY_PERMISSIONS)[number];

/**
 * Validates a requested list of key grants.
 *
 * Duplicates are collapsed and the result is returned in `API_KEY_PERMISSIONS`
 * order, so stored rows are canonical. Any value outside the known grants
 * rejects the whole list.
 */
export function parsePermissions(
  input: unknown
): { ok: true; value: ApiKeyPermission[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Permissions must be an array" };

  const requested = new Set<ApiKeyPermission>();
  for (const value of input) {
    if (!(API_KEY_PERMISSIONS as readonly unknown[]).includes(value)) {
      return { ok: false, error: `Unknown permission: ${String(value)}` };
    }
    requested.add(value as ApiKeyPermission);
  }

  return { ok: true, value: API_KEY_PERMISSIONS.filter((p) => requested.has(p)) };
}

/**
 * Reports whether a key's grants include the given action.
 */
export function hasPermission(perms: readonly ApiKeyPermission[], p: ApiKeyPermission): boolean {
  return perms.includes(p);
}
