import crypto from "crypto";

export const API_KEY_PREFIX = "qt_";
export const API_KEY_HEX_BYTES = 32;
export const API_KEY_LENGTH = 67; // API_KEY_PREFIX + 64 hex characters
export const KEY_PREFIX_LENGTH = 11; // API_KEY_PREFIX + 8 hex characters
export const API_KEY_LIMIT_PER_ORG = 5;
export const API_KEY_TTL_DAYS = 90;

export type ApiKeyStatus = "active" | "expired" | "revoked";

export interface ApiKeyRow {
  id: string;
  organization_id: string;
  expires_at: string;
  revoked_at: string | null;
}

export type PresentedKey =
  | { ok: true; key: string }
  | { ok: false; status: 401; error: string };

export type KeyLookupResult =
  | { ok: true; organizationId: string }
  | { ok: false; status: number; error: string };

const BEARER_PATTERN = /^Bearer\s+(.*)$/i;
const HEX_PATTERN = /^[0-9a-f]+$/;

/**
 * Generates a new API key.
 *
 * Returns the plaintext (shown to the caller once and never stored), the
 * non-secret display prefix, and the SHA-256 hash that is stored.
 */
export function generateApiKey(): { plaintext: string; prefix: string; hash: string } {
  const plaintext = API_KEY_PREFIX + crypto.randomBytes(API_KEY_HEX_BYTES).toString("hex");
  return {
    plaintext,
    prefix: plaintext.slice(0, KEY_PREFIX_LENGTH),
    hash: hashApiKey(plaintext),
  };
}

/**
 * Hashes a plaintext key for storage and lookup. No salt is needed because the
 * key carries 256 bits of randomness.
 */
export function hashApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

function isWellFormedKey(candidate: string): boolean {
  return (
    candidate.length === API_KEY_LENGTH &&
    candidate.startsWith(API_KEY_PREFIX) &&
    HEX_PATTERN.test(candidate.slice(API_KEY_PREFIX.length))
  );
}

/**
 * Reads the presented key from request headers.
 *
 * `Authorization: Bearer <key>` takes precedence; `X-API-Key` is read only when
 * `Authorization` is absent or is not a Bearer token. The candidate is format
 * checked here, before any hashing.
 */
export function extractPresentedKey(headers: Headers): PresentedKey {
  let candidate: string | null = null;

  const bearer = headers.get("authorization")?.match(BEARER_PATTERN);
  if (bearer) {
    candidate = bearer[1].trim();
  } else {
    const apiKeyHeader = headers.get("x-api-key");
    if (apiKeyHeader) candidate = apiKeyHeader.trim();
  }

  if (!candidate) return { ok: false, status: 401, error: "API key required" };
  if (!isWellFormedKey(candidate)) return { ok: false, status: 401, error: "Malformed API key" };
  return { ok: true, key: candidate };
}

/**
 * Derives a key's status from its row at the given time. Revocation is checked
 * first, so a key that is both revoked and expired reports as revoked.
 */
export function deriveKeyStatus(row: ApiKeyRow, now: Date): ApiKeyStatus {
  if (row.revoked_at !== null) return "revoked";
  if (new Date(row.expires_at) <= now) return "expired";
  return "active";
}

/**
 * Classifies the result of looking a key up by its hash.
 *
 * A database error is a 500, never a 401, so an outage is not reported to the
 * caller as a bad credential.
 */
export function classifyKeyLookup(
  lookup: { row: ApiKeyRow | null; error: unknown },
  now: Date
): KeyLookupResult {
  if (lookup.error) return { ok: false, status: 500, error: "Unable to verify credentials" };
  if (!lookup.row) return { ok: false, status: 401, error: "Invalid API key" };
  const status = deriveKeyStatus(lookup.row, now);
  if (status === "revoked") return { ok: false, status: 401, error: "API key revoked" };
  if (status === "expired") return { ok: false, status: 401, error: "API key expired" };
  return { ok: true, organizationId: lookup.row.organization_id };
}
