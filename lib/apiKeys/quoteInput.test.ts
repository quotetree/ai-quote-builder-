import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_ITEMS, isUuid, parseQuoteCreate, parseQuoteUpdate } from "./quoteInput.ts";

const PROJECT_ID = "7302e2d8-43ec-4998-9ed8-6939f2ea2276";

function item(overrides: Record<string, unknown> = {}) {
  return { product_name: "Shingles", quantity: 2, unit_price: 10, ...overrides };
}

function body(overrides: Record<string, unknown> = {}) {
  return { project_id: PROJECT_ID, quote_name: "Roof", items: [item()], ...overrides };
}

function errorOf(input: unknown): string {
  const result = parseQuoteCreate(input);
  assert.equal(result.ok, false, "expected the body to be rejected");
  return (result as { ok: false; error: string }).error;
}

describe("isUuid", () => {
  it("accepts a UUID", () => {
    assert.equal(isUuid(PROJECT_ID), true);
  });

  it("rejects other values", () => {
    assert.equal(isUuid("not-a-uuid"), false);
    assert.equal(isUuid(42), false);
    assert.equal(isUuid(null), false);
  });
});

describe("parseQuoteCreate", () => {
  it("returns trimmed values and defaults status to draft", () => {
    const result = parseQuoteCreate(
      body({
        quote_name: "  Roof  ",
        items: [item({ product_name: " Shingles ", product_number: " S-1 ", description: " Red " })],
      })
    );
    assert.deepEqual(result, {
      ok: true,
      value: {
        project_id: PROJECT_ID,
        quote_name: "Roof",
        status: "draft",
        expiration_date: null,
        items: [
          {
            product_name: "Shingles",
            product_number: "S-1",
            description: "Red",
            quantity: 2,
            unit_price: 10,
          },
        ],
      },
    });
  });

  it("accepts every optional field", () => {
    const result = parseQuoteCreate(
      body({
        status: "approved",
        expiration_date: "2026-12-31",
        items: [item({ discount_percent: 0.15 })],
      })
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.status, "approved");
      assert.equal(result.value.expiration_date, "2026-12-31");
      assert.equal(result.value.items[0].discount_percent, 0.15);
    }
  });

  for (const field of [
    "scope_of_work",
    "charges",
    "baked_markups",
    "quote_number",
    "organization_id",
    "user_id",
    "author_id",
  ]) {
    it(`rejects the ${field} field`, () => {
      assert.equal(errorOf(body({ [field]: "x" })), `Unknown field: ${field}`);
    });
  }

  it("rejects product_id inside an item", () => {
    assert.equal(
      errorOf(body({ items: [item(), item({ product_id: PROJECT_ID })] })),
      "Unknown field: items[1].product_id"
    );
  });

  for (const field of ["quantity", "unit_price", "discount_percent"]) {
    it(`rejects 3 decimal places on ${field}`, () => {
      assert.equal(
        errorOf(body({ items: [item({ [field]: 0.234 })] })),
        `items[0].${field} must have at most 2 decimal places`
      );
    });
  }

  it("rejects a discount above 1", () => {
    assert.equal(
      errorOf(body({ items: [item({ discount_percent: 1.5 })] })),
      "items[0].discount_percent must be at most 1"
    );
  });

  it("rejects a quantity of 0", () => {
    assert.equal(
      errorOf(body({ items: [item({ quantity: 0 })] })),
      "items[0].quantity must be greater than 0"
    );
  });

  it("rejects a negative price", () => {
    assert.equal(
      errorOf(body({ items: [item({ unit_price: -1 })] })),
      "items[0].unit_price must be at least 0"
    );
  });

  it("rejects a quantity too large for its column", () => {
    assert.match(errorOf(body({ items: [item({ quantity: 100_000_000 })] })), /quantity must be at most/);
  });

  it("rejects a non-numeric quantity", () => {
    assert.equal(
      errorOf(body({ items: [item({ quantity: "2" })] })),
      "items[0].quantity must be a number"
    );
  });

  for (const [label, value] of [
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", "   "],
    ["null", null],
  ] as const) {
    it(`rejects a ${label} quote_name`, () => {
      const input: Record<string, unknown> = body({ quote_name: value });
      if (value === undefined) delete input.quote_name;
      assert.equal(errorOf(input), "quote_name is required");
    });
  }

  it("rejects a quote_name over 200 characters", () => {
    assert.equal(
      errorOf(body({ quote_name: "x".repeat(201) })),
      "quote_name must be at most 200 characters"
    );
  });

  it("rejects an impossible expiration_date", () => {
    assert.equal(errorOf(body({ expiration_date: "2026-02-30" })), "expiration_date is not a real date");
  });

  it("rejects a malformed expiration_date", () => {
    assert.equal(
      errorOf(body({ expiration_date: "12/31/2026" })),
      "expiration_date must be a date in YYYY-MM-DD form"
    );
  });

  it("rejects an unknown status", () => {
    assert.match(errorOf(body({ status: "sent" })), /^status must be one of/);
  });

  it("rejects 0 items", () => {
    assert.equal(errorOf(body({ items: [] })), "items must hold from 1 to 500 entries");
  });

  it(`rejects ${MAX_ITEMS + 1} items and accepts ${MAX_ITEMS}`, () => {
    assert.equal(
      errorOf(body({ items: Array.from({ length: MAX_ITEMS + 1 }, () => item()) })),
      "items must hold from 1 to 500 entries"
    );
    assert.equal(parseQuoteCreate(body({ items: Array.from({ length: MAX_ITEMS }, () => item()) })).ok, true);
  });

  it("rejects a non-UUID project_id", () => {
    assert.equal(errorOf(body({ project_id: "not-a-uuid" })), "project_id must be a UUID");
  });

  it("rejects a non-string product_number", () => {
    assert.equal(
      errorOf(body({ items: [item({ product_number: 7 })] })),
      "items[0].product_number must be a string"
    );
  });

  for (const [label, value] of [
    ["null", null],
    ["an array", []],
    ["a string", "{}"],
  ] as const) {
    it(`rejects ${label} as the body`, () => {
      assert.equal(errorOf(value), "Request body must be a JSON object");
    });
  }
});

describe("parseQuoteUpdate", () => {
  function updateError(input: unknown): string {
    const result = parseQuoteUpdate(input);
    assert.equal(result.ok, false, "expected the body to be rejected");
    return (result as { ok: false; error: string }).error;
  }

  it("accepts quote_name alone, trimmed", () => {
    assert.deepEqual(parseQuoteUpdate({ quote_name: "  Roof v2 " }), {
      ok: true,
      value: { quote_name: "Roof v2" },
    });
  });

  it("accepts status alone", () => {
    assert.deepEqual(parseQuoteUpdate({ status: "approved" }), {
      ok: true,
      value: { status: "approved" },
    });
  });

  it("accepts expiration_date alone", () => {
    assert.deepEqual(parseQuoteUpdate({ expiration_date: "2026-12-31" }), {
      ok: true,
      value: { expiration_date: "2026-12-31" },
    });
  });

  it("accepts items alone", () => {
    assert.deepEqual(parseQuoteUpdate({ items: [item({ product_name: " Nails " })] }), {
      ok: true,
      value: { items: [{ product_name: "Nails", quantity: 2, unit_price: 10 }] },
    });
  });

  it("rejects an empty object", () => {
    assert.equal(
      updateError({}),
      "Request body must include at least one of quote_name, status, expiration_date, items"
    );
  });

  it("rejects project_id", () => {
    assert.equal(updateError({ project_id: PROJECT_ID, status: "draft" }), "Unknown field: project_id");
  });

  it("rejects product_id inside an item", () => {
    assert.equal(
      updateError({ items: [item({ product_id: PROJECT_ID })] }),
      "Unknown field: items[0].product_id"
    );
  });

  for (const [label, value] of [
    ["null", null],
    ["empty", ""],
    ["whitespace-only", "   "],
  ] as const) {
    it(`rejects a ${label} quote_name`, () => {
      assert.equal(updateError({ quote_name: value }), "quote_name is required");
    });
  }

  it("rejects a null expiration_date", () => {
    assert.equal(
      updateError({ expiration_date: null }),
      "expiration_date must be a date in YYYY-MM-DD form"
    );
  });

  it("rejects an empty items list", () => {
    assert.equal(updateError({ items: [] }), "items must hold from 1 to 500 entries");
  });

  it("rejects a non-object body", () => {
    assert.equal(updateError(null), "Request body must be a JSON object");
  });
});
