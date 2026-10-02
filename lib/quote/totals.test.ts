import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_MONEY, computeQuoteTotals, fitsMoneyColumns } from "./totals.ts";

describe("computeQuoteTotals", () => {
  it("applies the discount as a fraction and rounds the line to cents", () => {
    const totals = computeQuoteTotals([
      { product_name: "A", quantity: 3, unit_price: 19.99, discount_percent: 0.15 },
    ]);
    assert.equal(totals.items[0].line_total, 50.97);
    assert.equal(totals.subtotal, 50.97);
  });

  it("gives zero for a full discount", () => {
    const totals = computeQuoteTotals([
      { product_name: "A", quantity: 4, unit_price: 25, discount_percent: 1 },
    ]);
    assert.equal(totals.items[0].line_total, 0);
    assert.equal(totals.subtotal, 0);
  });

  it("defaults a missing discount to 0", () => {
    const totals = computeQuoteTotals([{ product_name: "A", quantity: 2, unit_price: 1.5 }]);
    assert.equal(totals.items[0].discount_percent, 0);
    assert.equal(totals.items[0].line_total, 3);
  });

  it("sums the rounded lines, not the raw lines", () => {
    // Each raw line is 0.333..., which rounds to 0.33; the raw sum would round to 1.00
    const item = { product_name: "A", quantity: 1, unit_price: 1, discount_percent: 2 / 3 };
    const totals = computeQuoteTotals([item, item, item]);
    assert.deepEqual(
      totals.items.map((i) => i.line_total),
      [0.33, 0.33, 0.33]
    );
    assert.equal(totals.subtotal, 0.99);
  });

  it("numbers sort_order by input position", () => {
    const totals = computeQuoteTotals([
      { product_name: "first", quantity: 1, unit_price: 1 },
      { product_name: "second", quantity: 1, unit_price: 1 },
      { product_name: "third", quantity: 1, unit_price: 1 },
    ]);
    assert.deepEqual(
      totals.items.map((i) => [i.product_name, i.sort_order]),
      [
        ["first", 0],
        ["second", 1],
        ["third", 2],
      ]
    );
  });
});

describe("fitsMoneyColumns", () => {
  it("accepts totals at the column maximum", () => {
    assert.equal(
      fitsMoneyColumns(computeQuoteTotals([{ product_name: "A", quantity: 1, unit_price: MAX_MONEY }])),
      true
    );
  });

  it("rejects a subtotal past the column maximum", () => {
    const totals = computeQuoteTotals([
      { product_name: "A", quantity: 1, unit_price: MAX_MONEY },
      { product_name: "B", quantity: 1, unit_price: 1 },
    ]);
    assert.equal(fitsMoneyColumns(totals), false);
  });

  it("rejects a single line past the column maximum", () => {
    const totals = computeQuoteTotals([{ product_name: "A", quantity: 2, unit_price: MAX_MONEY }]);
    assert.equal(fitsMoneyColumns(totals), false);
  });
});
