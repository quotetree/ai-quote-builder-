import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assistantOfferedWebSearch,
  buildWebSearchQueriesFromConversation,
  extractBrandFromConversation,
  isWebResearchFollowUp,
  isWebSearchApprovalMessage,
  shouldRunWebResearch,
} from "./webResearchContext.js";

describe("webResearchContext", () => {
  it("detects yes proceed after web search offer", () => {
    const history = [
      {
        role: "assistant" as const,
        content:
          "I did not find Hanwha in your price book. I can run a web search for distributors. Let me know if you would like me to proceed.",
      },
    ];
    assert.ok(isWebSearchApprovalMessage("yes proceed with the search"));
    assert.ok(assistantOfferedWebSearch(history));
    assert.ok(shouldRunWebResearch("yes proceed with the search", history));
    assert.ok(isWebResearchFollowUp("yes proceed with the search", history));
  });

  it("builds Hanwha distributor and product queries from history", () => {
    const history = [
      {
        role: "user" as const,
        content: "find Hanwha 5MP outdoor vandal dome in our pricebook or online",
      },
      {
        role: "assistant" as const,
        content: "No Hanwha match in price book. Want me to search online for distributors?",
      },
    ];
    const queries = buildWebSearchQueriesFromConversation("yes proceed", history);
    assert.ok(queries.some((q) => /hanwha/i.test(q)));
    assert.ok(queries.some((q) => /distribut/i.test(q) || /ADI|Wesco/i.test(q)));
    assert.equal(extractBrandFromConversation("yes proceed", history), "Hanwha Vision");
  });
});
