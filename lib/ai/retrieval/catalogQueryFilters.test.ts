import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCategoryHintFromTerms,
  extractProductPhraseFromQuery,
  isCatalogBrowseQuery,
  parseCatalogQueryFilters,
  productMatchesCategoryHint,
  enrichCatalogFiltersFromTerms,
} from "./catalogQueryFilters.js";
import { normalizeCatalogQuery } from "./catalogQueryNormalize.js";

describe("catalogQueryFilters", () => {
  it("parses what do we carry bullet cameras under $1000", () => {
    const q = "What bullet cameras do we carry that are under $1000";
    const n = normalizeCatalogQuery(q);
    const f = enrichCatalogFiltersFromTerms(parseCatalogQueryFilters(q), n.terms);
    assert.equal(f.maxSalesPrice, 1000);
    assert.equal(f.categoryHint, "bullet cameras");
    assert.equal(f.listAll, true);
    assert.ok(isCatalogBrowseQuery(f, n.terms.length));
  });

  it("matches bullet camera products with singular camera in type", () => {
    assert.ok(
      productMatchesCategoryHint(
        {
          product_name: "Axis P3245-V Bullet",
          product_type: "Camera",
          product_tags: [],
        },
        "bullet cameras",
      ),
    );
    assert.ok(
      productMatchesCategoryHint(
        {
          product_name: "Hanwha QNO-6082R",
          product_type: "Bullet Camera",
          product_tags: [],
        },
        "bullet cameras",
      ),
    );
    assert.ok(
      !productMatchesCategoryHint(
        { product_name: "Dome Camera 4MP", product_type: "Camera", product_tags: [] },
        "bullet cameras",
      ),
    );
  });

  it("extracts phrase from what do we carry", () => {
    assert.equal(
      extractProductPhraseFromQuery("What poe switches do we carry under $500"),
      "poe switches",
    );
  });

  it("buildCategoryHintFromTerms drops carry", () => {
    assert.equal(buildCategoryHintFromTerms(["bullet", "cameras", "carry"]), "bullet cameras");
  });

  it("parses verkada which cameras do we sell", () => {
    const q = "what about from Verkada which verkada cameras do we currently sell";
    const f = parseCatalogQueryFilters(q);
    assert.equal(f.manufacturer, "verkada");
    assert.equal(f.listAll, true);
    assert.ok(f.categoryHint?.includes("camera"));
  });

  it("matches verkada CM42 by brand and camera type", () => {
    assert.ok(
      productMatchesCategoryHint(
        {
          product_name: "Verkada CM42 Multisensor",
          product_type: "Camera",
        },
        "cameras",
      ),
    );
  });

  it("parses over 1k as min sales price", () => {
    assert.equal(
      parseCatalogQueryFilters("all cameras in our pricebook over 1k").minSalesPrice,
      1000,
    );
  });
});
