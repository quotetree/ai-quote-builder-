import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildProductResearchWebQueries,
  isCatalogOnlyPricebookQuery,
  isHybridPricebookSpecQuery,
  isProductResearchFromConversation,
  isProductSpecResearchQuery,
  isSimpleCatalogLookup,
  userWantsPricebookSearch,
} from "./productResearchContext.js";

describe("productResearchContext", () => {
  it("detects mini dome 8MP research query", () => {
    const q =
      "Can you do some researhc on the mini domes and let me know which one has a 8mp lense";
    assert.ok(isProductSpecResearchQuery(q));
    assert.equal(isSimpleCatalogLookup(q), false);
    assert.equal(userWantsPricebookSearch(q), false);
  });

  it("does not treat simple pricebook lookup as research", () => {
    const q = "How much is verkada CM42 in our pricebook";
    assert.equal(isProductSpecResearchQuery(q), false);
    assert.ok(isSimpleCatalogLookup(q));
  });

  it("detects fisheye MP follow-up mentioning pricebook (hybrid, not catalog-only)", () => {
    const q =
      "what is the MP of these Fishey Cameras from Verkada that you found in our pricebook";
    const history = [
      {
        role: "assistant" as const,
        content:
          "Here are Verkada fisheye options from your price book: CF81-E, CM42, CD43 with specs...",
      },
    ];
    assert.ok(isHybridPricebookSpecQuery(q, history));
    assert.ok(isProductResearchFromConversation(q, history));
    assert.equal(isCatalogOnlyPricebookQuery(q, history), false);
  });

  it("builds Verkada spec search queries", () => {
    const queries = buildProductResearchWebQueries(
      "research mini domes which has 8mp",
      [{ role: "user", content: "verkada mini dome cameras" }],
    );
    assert.ok(queries.some((q) => /verkada/i.test(q) && /mini dome/i.test(q)));
    assert.ok(queries.some((q) => /8\s*mp|8MP/i.test(q)));
  });
});
