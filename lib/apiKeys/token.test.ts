import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  API_KEY_LENGTH,
  KEY_PREFIX_LENGTH,
  classifyKeyLookup,
  deriveKeyStatus,
  extractPresentedKey,
  generateApiKey,
  hashApiKey,
  type ApiKeyRow,
} from "./token.ts";

const NOW = new Date("2026-10-01T12:00:00Z");
const PAST = "2026-09-30T12:00:00Z";
const FUTURE = "2026-12-30T12:00:00Z";

function row(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: "key-1",
    organization_id: "org-1",
    expires_at: FUTURE,
    revoked_at: null,
    ...overrides,
  };
}

describe("generateApiKey", () => {
  it("returns a plaintext whose prefix and hash correspond to it", () => {
    const { plaintext, prefix, hash } = generateApiKey();
    assert.equal(plaintext.length, API_KEY_LENGTH);
    assert.ok(plaintext.startsWith("qt_"));
    assert.equal(prefix, plaintext.slice(0, KEY_PREFIX_LENGTH));
    assert.equal(hashApiKey(plaintext), hash);
  });

  it("stores only an 11-character prefix and a SHA-256 digest", () => {
    const { plaintext, prefix, hash } = generateApiKey();
    assert.equal(prefix.length, KEY_PREFIX_LENGTH);
    assert.equal(KEY_PREFIX_LENGTH, 11);
    assert.equal(plaintext.length, 67);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, crypto.createHash("sha256").update(plaintext).digest("hex"));
    assert.notEqual(hash, plaintext);
    assert.ok(!hash.includes(plaintext.slice(KEY_PREFIX_LENGTH)));
  });

  it("produces a different key each call", () => {
    assert.notEqual(generateApiKey().plaintext, generateApiKey().plaintext);
  });
});

describe("deriveKeyStatus", () => {
  it("reports a live key as active", () => {
    assert.equal(deriveKeyStatus(row(), NOW), "active");
  });

  it("reports a key past expires_at as expired", () => {
    assert.equal(deriveKeyStatus(row({ expires_at: PAST }), NOW), "expired");
  });

  it("reports a key expiring exactly now as expired", () => {
    assert.equal(deriveKeyStatus(row({ expires_at: NOW.toISOString() }), NOW), "expired");
  });

  it("reports a revoked key as revoked", () => {
    assert.equal(deriveKeyStatus(row({ revoked_at: PAST }), NOW), "revoked");
  });

  it("reports a key that is both revoked and expired as revoked", () => {
    assert.equal(deriveKeyStatus(row({ revoked_at: PAST, expires_at: PAST }), NOW), "revoked");
  });
});

describe("extractPresentedKey", () => {
  const keyA = generateApiKey().plaintext;
  const keyB = generateApiKey().plaintext;

  it("accepts Authorization: Bearer alone", () => {
    const result = extractPresentedKey(new Headers({ Authorization: `Bearer ${keyA}` }));
    assert.deepEqual(result, { ok: true, key: keyA });
  });

  it("compares the Bearer scheme case-insensitively", () => {
    const result = extractPresentedKey(new Headers({ Authorization: `bearer ${keyA}` }));
    assert.deepEqual(result, { ok: true, key: keyA });
  });

  it("accepts X-API-Key alone", () => {
    const result = extractPresentedKey(new Headers({ "X-API-Key": keyB }));
    assert.deepEqual(result, { ok: true, key: keyB });
  });

  it("prefers Authorization when both headers carry different keys", () => {
    const result = extractPresentedKey(
      new Headers({ Authorization: `Bearer ${keyA}`, "X-API-Key": keyB })
    );
    assert.deepEqual(result, { ok: true, key: keyA });
  });

  it("falls through to X-API-Key when Authorization is not a Bearer token", () => {
    const result = extractPresentedKey(
      new Headers({ Authorization: "Basic dXNlcjpwYXNz", "X-API-Key": keyB })
    );
    assert.deepEqual(result, { ok: true, key: keyB });
  });

  it("does not fall through when a Bearer header carries a malformed key", () => {
    const result = extractPresentedKey(
      new Headers({ Authorization: "Bearer qt_bogus", "X-API-Key": keyB })
    );
    assert.deepEqual(result, { ok: false, status: 401, error: "Malformed API key" });
  });

  it("reports an empty header set as a missing key", () => {
    assert.deepEqual(extractPresentedKey(new Headers()), {
      ok: false,
      status: 401,
      error: "API key required",
    });
  });

  const malformed: Array<[string, string]> = [
    ["wrong prefix", "xx_" + keyA.slice(3)],
    ["too short", keyA.slice(0, -1)],
    ["too long", keyA + "0"],
    ["oversized", "qt_" + "a".repeat(10_000)],
    ["non-hex body", "qt_" + "z".repeat(64)],
    ["uppercase hex body", "qt_" + keyA.slice(3).toUpperCase().replace(/[0-9]/g, "A")],
  ];

  for (const [label, candidate] of malformed) {
    it(`rejects a key with a ${label} before hashing`, () => {
      assert.deepEqual(extractPresentedKey(new Headers({ Authorization: `Bearer ${candidate}` })), {
        ok: false,
        status: 401,
        error: "Malformed API key",
      });
      assert.deepEqual(extractPresentedKey(new Headers({ "X-API-Key": candidate })), {
        ok: false,
        status: 401,
        error: "Malformed API key",
      });
    });
  }
});

describe("classifyKeyLookup", () => {
  it("maps a lookup error to 500, not 401", () => {
    assert.deepEqual(classifyKeyLookup({ row: null, error: new Error("connection refused") }, NOW), {
      ok: false,
      status: 500,
      error: "Unable to verify credentials",
    });
  });

  it("maps a missing row to 401 Invalid API key", () => {
    assert.deepEqual(classifyKeyLookup({ row: null, error: null }, NOW), {
      ok: false,
      status: 401,
      error: "Invalid API key",
    });
  });

  it("maps a revoked row to 401 API key revoked", () => {
    assert.deepEqual(classifyKeyLookup({ row: row({ revoked_at: PAST }), error: null }, NOW), {
      ok: false,
      status: 401,
      error: "API key revoked",
    });
  });

  it("maps an expired row to 401 API key expired", () => {
    assert.deepEqual(classifyKeyLookup({ row: row({ expires_at: PAST }), error: null }, NOW), {
      ok: false,
      status: 401,
      error: "API key expired",
    });
  });

  it("maps a live row to its organization", () => {
    assert.deepEqual(classifyKeyLookup({ row: row(), error: null }, NOW), {
      ok: true,
      organizationId: "org-1",
    });
  });
});
