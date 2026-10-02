import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { projectV1Quote } from "./v1Quote.ts";

describe("projectV1Quote", () => {
  const quote = {
    id: "q-1",
    quote_number: "Q-0001",
    quote_name: "Roof",
    status: "draft",
    subtotal: 10,
    tax_amount: 0,
    total_price: 10,
    expiration_date: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    user_id: "u-1",
    organization_id: "o-1",
    scope_of_work: "Generated from spreadsheet",
    charges: [],
  };
  const item = {
    id: "i-1",
    quote_id: "q-1",
    product_id: null,
    product_name: "Shingles",
    product_number: "S-1",
    description: null,
    quantity: 2,
    unit_price: 5,
    discount_percent: 0,
    line_total: 10,
    sort_order: 0,
    created_at: "2026-10-01T00:00:00Z",
  };

  it("drops quote columns outside the published list", () => {
    const result = projectV1Quote(quote, []);
    assert.equal("user_id" in result, false);
    assert.equal("organization_id" in result, false);
    assert.equal("scope_of_work" in result, false);
    assert.equal("charges" in result, false);
  });

  it("keeps the published quote columns", () => {
    const result = projectV1Quote(quote, []);
    assert.deepEqual(result, {
      id: "q-1",
      quote_number: "Q-0001",
      quote_name: "Roof",
      status: "draft",
      subtotal: 10,
      tax_amount: 0,
      total_price: 10,
      expiration_date: null,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      items: [],
    });
  });

  it("projects each item to the published item columns", () => {
    const result = projectV1Quote(quote, [item]);
    assert.deepEqual(result.items, [
      {
        id: "i-1",
        product_name: "Shingles",
        product_number: "S-1",
        description: null,
        quantity: 2,
        unit_price: 5,
        discount_percent: 0,
        line_total: 10,
        sort_order: 0,
      },
    ]);
  });
});
