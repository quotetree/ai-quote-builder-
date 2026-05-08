import crypto from "crypto";

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getSecret(): string {
  const secret = process.env.PROPOSAL_EXPORT_SECRET;
  if (!secret) throw new Error("PROPOSAL_EXPORT_SECRET is not configured");
  return secret;
}

/**
 * Generates a short-lived signed token for a specific quoteId.
 *
 * Format: `{expiresAtMs}.{hmac-sha256-hex}`
 *
 * The HMAC signs the string `{quoteId}:{expiresAtMs}`, binding the token
 * to both the specific quote and the expiry time.  Any tampering with either
 * field invalidates the signature.
 */
export function generateExportToken(quoteId: string): string {
  const secret = getSecret();
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${quoteId}:${expiresAt}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${expiresAt}.${sig}`;
}

/**
 * Verifies an export token against the given quoteId.
 *
 * Returns true only when:
 *   1. The token is well-formed (two dot-separated parts)
 *   2. The expiry timestamp has not passed
 *   3. The HMAC signature matches (timing-safe comparison)
 */
export function verifyExportToken(quoteId: string, token: string): boolean {
  try {
    const secret = getSecret();
    const dotIdx = token.indexOf(".");
    if (dotIdx === -1) return false;

    const expiresAt = parseInt(token.slice(0, dotIdx), 10);
    const sig = token.slice(dotIdx + 1);

    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

    const payload = `${quoteId}:${expiresAt}`;
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    // Constant-time comparison prevents timing-based attacks
    const sigBuf = Buffer.from(sig, "hex");
    const expectedBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}
