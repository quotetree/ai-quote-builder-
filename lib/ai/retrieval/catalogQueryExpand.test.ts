import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  expandCatalogSearchTerms,
  extractCatalogIntent,
  scoreExpandedCatalogMatch,
  splitCoreAndGenericTerms,
  tokenMatchesProductText,
} from "./catalogQueryExpand.js";
import { normalizeCatalogQuery } from "./catalogQueryNormalize.js";
import {
  extractProductPhraseFromQuery,
  meaningfulCategoryTokens,
  productMatchesCategoryHint,
} from "./catalogQueryFilters.js";

describe("catalogQueryExpand", () => {
  it("extracts inventory lookup intent from find all we sell", () => {
    const q =
      "I need you to find me all of the different Cat6 cables that we sell and let me know what the pricing and margins are for each item.";
    assert.equal(extractCatalogIntent(q), "inventory_lookup");
  });

  it("splits cat6 as core and cables as generic", () => {
    const expanded = expandCatalogSearchTerms("Cat6 cables we sell", ["cat6", "cables"]);
    assert.ok(expanded.coreTerms.includes("cat6"));
    assert.ok(expanded.genericTerms.includes("cables"));
  });

  it("matches CAT6 patch panel when user asked for cat6 cables", () => {
    const n = normalizeCatalogQuery("Cat6 cables");
    const expanded = expandCatalogSearchTerms("Cat6 cables", [...n.terms, "cables"]);
    const productText =
      "ADI PRO OE-C6PP24 CAT6 24-Port Patch Panel consumable adi global";
    const result = scoreExpandedCatalogMatch(productText, expanded);
    assert.ok(result.score >= 0.4, `expected match, got score ${result.score}`);
    assert.ok(
      result.confidence === "high" || result.confidence === "medium",
      `confidence ${result.confidence}`,
    );
  });

  it("tokenMatchesProductText handles cat6 and C6PP SKU patterns", () => {
    assert.ok(
      tokenMatchesProductText(
        "cat6",
        "ADI PRO OE-C6PP24 CAT6 24-Port Patch Panel",
      ),
    );
    assert.ok(tokenMatchesProductText("cables", "CAT6 24-Port Patch Panel"));
  });

  it("extracts cat6 phrase from find all we sell query", () => {
    const q =
      "find me all of the different Cat6 cables that we sell";
    const phrase = extractProductPhraseFromQuery(q);
    assert.ok(phrase?.includes("cat6"), `phrase: ${phrase}`);
    const tokens = meaningfulCategoryTokens(phrase ?? "");
    assert.ok(tokens.includes("cat6"));
    assert.ok(!tokens.includes("cables"));
  });

  it("productMatchesCategoryHint matches patch panel for cat6 hint only", () => {
    assert.ok(
      productMatchesCategoryHint(
        {
          product_name: "ADI PRO OE-C6PP24 CAT6 24-Port Patch Panel",
          product_type: "Consumable",
          product_tags: [],
        },
        "cat6",
      ),
    );
    assert.ok(
      productMatchesCategoryHint(
        {
          product_name: "ADI PRO OE-C6PP24 CAT6 24-Port Patch Panel",
          product_type: "Consumable",
        },
        "cat6 cables",
      ),
    );
  });
});
