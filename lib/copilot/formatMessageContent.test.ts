import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  preprocessCopilotContent,
  stripInternalCitationTags,
} from "./formatMessageContent.js";

describe("stripInternalCitationTags", () => {
  it("removes inline pricebook tag from product name", () => {
    const raw =
      "Rhombus R200 Mini Dome Camera [pricebook:f1674f7b-3eb-48f1-87c2-3fa9e2fcfb7]";
    assert.equal(
      stripInternalCitationTags(raw),
      "Rhombus R200 Mini Dome Camera",
    );
  });

  it("removes pricebook tag on its own line under product name", () => {
    const raw = `RHOMBUS Multisensor Camera ENT 1Y LIC
[pricebook:794489d3-e35e-47aa-9888-c888131da588]`;
    const cleaned = stripInternalCitationTags(raw);
    assert.doesNotMatch(cleaned, /pricebook:/i);
    assert.match(cleaned, /RHOMBUS Multisensor Camera ENT 1Y LIC/);
  });

  it("cleans markdown table cells", () => {
    const raw =
      "| Rhombus R200 [pricebook:f1674f7b-3eb-48f1-87c2-3fa9e2fcfb7] | R200 | $499 |";
    assert.equal(
      stripInternalCitationTags(raw),
      "| Rhombus R200 | R200 | $499 |",
    );
  });

  it("strips tags in preprocessCopilotContent", () => {
    const raw = "**Product** [pricebook:abc-123-def-456-789012345678] — $99";
    const out = preprocessCopilotContent(raw);
    assert.doesNotMatch(out, /pricebook:/i);
    assert.match(out, /\*\*Product\*\*/);
  });
});
