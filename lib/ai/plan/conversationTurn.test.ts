import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCatalogInventoryQuestion,
  isCatalogListFollowUp,
} from "./catalogConversation.js";
import {
  assessTaskComplexity,
  dedupeHistoryCurrentMessage,
  inferTurnIntent,
} from "./conversationTurn.js";
import { shouldRunWebResearch } from "./webResearchContext.js";

describe("conversationTurn", () => {
  it("dedupes current user message from history", () => {
    const history = [
      { role: "user" as const, content: "hello" },
      { role: "user" as const, content: "find verkada in pricebook" },
    ];
    const out = dedupeHistoryCurrentMessage(history, "find verkada in pricebook");
    assert.equal(out.length, 1);
  });

  it("routes compare-to-pricebook follow-up as hybrid", () => {
    const history = [
      { role: "user" as const, content: "research mini domes 8mp" },
      {
        role: "assistant" as const,
        content: "Verkada CM42 and CD43 are 4MP mini domes...",
      },
    ];
    const intent = inferTurnIntent("now compare that to my price book", history);
    assert.equal(intent, "hybrid_catalog_web");
    assert.equal(
      assessTaskComplexity("now compare that to my price book", history, intent),
      "deep",
    );
  });

  it("routes search-for-that after catalog thread as catalog", () => {
    const history = [
      { role: "user" as const, content: "how much is verkada CM42 in our pricebook" },
      { role: "assistant" as const, content: "CM42 is $1,200 in your price book..." },
    ];
    const intent = inferTurnIntent("okay now search for that", history);
    assert.equal(intent, "catalog_lookup");
  });

  it("routes which-brand-do-we-sell as catalog not web research", () => {
    const msg = "Which Verkada cameras do we currently sell?";
    assert.equal(isCatalogInventoryQuestion(msg), true);
    assert.equal(inferTurnIntent(msg, []), "catalog_lookup");
    assert.equal(shouldRunWebResearch(msg, []), false);
  });

  it("routes list-it-out after verkada inventory thread as catalog", () => {
    const history = [
      {
        role: "user" as const,
        content: "Which Verkada cameras do we currently sell?",
      },
      {
        role: "assistant" as const,
        content: "You can search your price book for CD22, CD43...",
      },
    ];
    const msg = "I need you to list it out";
    assert.equal(isCatalogListFollowUp(msg, history), true);
    assert.equal(inferTurnIntent(msg, history), "catalog_lookup");
    assert.equal(shouldRunWebResearch(msg, history), false);
  });
});
