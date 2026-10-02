import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { API_KEY_PERMISSIONS, hasPermission, parsePermissions } from "./permissions.ts";

describe("parsePermissions", () => {
  it("accepts an empty array as read-only", () => {
    assert.deepEqual(parsePermissions([]), { ok: true, value: [] });
  });

  for (const permission of API_KEY_PERMISSIONS) {
    it(`accepts ${permission} alone`, () => {
      assert.deepEqual(parsePermissions([permission]), { ok: true, value: [permission] });
    });
  }

  it("accepts all three grants", () => {
    assert.deepEqual(parsePermissions(["quotes:create", "quotes:update", "quotes:delete"]), {
      ok: true,
      value: ["quotes:create", "quotes:update", "quotes:delete"],
    });
  });

  it("collapses duplicates", () => {
    assert.deepEqual(parsePermissions(["quotes:delete", "quotes:delete"]), {
      ok: true,
      value: ["quotes:delete"],
    });
  });

  it("returns out-of-order input in canonical order", () => {
    assert.deepEqual(parsePermissions(["quotes:delete", "quotes:create"]), {
      ok: true,
      value: ["quotes:create", "quotes:delete"],
    });
  });

  it("rejects an unknown string", () => {
    assert.deepEqual(parsePermissions(["quotes:create", "quotes:publish"]), {
      ok: false,
      error: "Unknown permission: quotes:publish",
    });
  });

  it("rejects a non-string element", () => {
    assert.deepEqual(parsePermissions([1]), { ok: false, error: "Unknown permission: 1" });
  });

  for (const [label, input] of [
    ["null", null],
    ["an object", { "quotes:create": true }],
    ["a string", "quotes:create"],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.equal(parsePermissions(input).ok, false);
    });
  }
});

describe("hasPermission", () => {
  it("is true when the grant is present", () => {
    assert.equal(hasPermission(["quotes:create", "quotes:delete"], "quotes:delete"), true);
  });

  it("is false when the grant is absent", () => {
    assert.equal(hasPermission(["quotes:create"], "quotes:delete"), false);
    assert.equal(hasPermission([], "quotes:create"), false);
  });
});
