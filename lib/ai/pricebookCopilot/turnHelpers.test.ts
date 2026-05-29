import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessPricebookTaskComplexity,
  filterCatalogHistory,
} from "./turnHelpers.js";

describe("assessPricebookTaskComplexity", () => {
  it("marks simple price lookups as simple", () => {
    assert.equal(assessPricebookTaskComplexity("How much is the Verkada CD62?"), "simple");
  });

  it("marks margin and compare queries as deep", () => {
    assert.equal(assessPricebookTaskComplexity("Compare all bullet cameras under $500"), "deep");
    assert.equal(assessPricebookTaskComplexity("What's the margin on SKU ABC-123?"), "deep");
  });
});

describe("filterCatalogHistory", () => {
  it("drops assistant catalog lists without pricebook ids", () => {
    const filtered = filterCatalogHistory([
      { role: "user", content: "Do we sell Verkada domes?" },
      {
        role: "assistant",
        content: "Yes — Verkada CD62 dome camera at $899 sales price.",
      },
    ]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.role, "user");
  });

  it("keeps assistant catalog lists with pricebook ids", () => {
    const filtered = filterCatalogHistory([
      {
        role: "assistant",
        content: "Verkada CD62 [pricebook:abc-123-def] — Sales $899",
      },
    ]);
    assert.equal(filtered.length, 1);
  });
});
