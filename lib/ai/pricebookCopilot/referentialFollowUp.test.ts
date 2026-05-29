import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractPricebookIdsFromText,
  isReferentialProductFollowUp,
  resolveReferentialFollowUp,
} from "./referentialFollowUp.js";

const ASSISTANT_RHOMBUS = `Here are the cameras we carry from Rhombus:

| Product | SKU | Sales (catalog) |
| --- | --- | --- |
| Rhombus R200 Mini Dome Camera [pricebook:f1674f7b-3eb-48f1-87c2-3fa9e2fcfb7] | R200-128GB | **$499.00** |
| Rhombus R400 Dome Camera [pricebook:a1b2c3d4-e5f6-7890-abcd-ef1234567890] | R400 | **$799.00** |`;

describe("referentialFollowUp", () => {
  it("extracts pricebook ids from assistant table", () => {
    const ids = extractPricebookIdsFromText(ASSISTANT_RHOMBUS);
    assert.equal(ids.length, 2);
    assert.equal(ids[0], "f1674f7b-3eb-48f1-87c2-3fa9e2fcfb7");
  });

  it("detects margin follow-up on these products", () => {
    assert.ok(
      isReferentialProductFollowUp(
        "What is our profit margin on all of these different products?",
      ),
    );
  });

  it("resolves follow-up to prior assistant product ids", () => {
    const history = [
      { role: "user" as const, content: "What cameras do we carry from Rhombus?" },
      { role: "assistant" as const, content: ASSISTANT_RHOMBUS },
    ];
    const resolved = resolveReferentialFollowUp(
      "What is our profit margin on all of these different products?",
      history,
    );
    assert.ok(resolved);
    assert.equal(resolved!.productIds.length, 2);
    assert.match(resolved!.priorResultLabel ?? "", /Rhombus/i);
  });

  it("does not resolve when prior assistant has no pricebook ids", () => {
    const history = [
      { role: "user" as const, content: "What cameras from Rhombus?" },
      { role: "assistant" as const, content: "We carry several Rhombus cameras at various prices." },
    ];
    assert.equal(
      resolveReferentialFollowUp("What is the margin on these products?", history),
      null,
    );
  });

  it("does not treat fresh inventory question as referential", () => {
    assert.ok(
      !isReferentialProductFollowUp("What cameras do we carry from Rhombus?"),
    );
  });
});
