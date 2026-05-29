import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildWebSearchQuery,
  isAttachmentSpecQuestion,
  isExternalWebResearchQuery,
  isPricebookPrimaryPhrase,
  routeCopilotRetrieval,
  routePricebookCopilotRetrieval,
  shouldLoadPlanAttachmentContext,
} from "./retrievalRouter.js";
import {
  normalizeCatalogQuery,
  passesCatalogMatchThreshold,
  scoreCatalogMatch,
} from "./catalogQueryNormalize.js";

describe("routeCopilotRetrieval", () => {
  it("routes cellular gateway catalog query to pricebook only with attachments", () => {
    const plan = routeCopilotRetrieval(
      "Find the different cellular gateways we sell for a setup for a remote telecom site.",
      { hasAttachments: true, attachmentCount: 1 },
    );
    assert.ok(plan.sources.includes("pricebook"));
    assert.equal(plan.primarySource, "pricebook");
    assert.equal(plan.loadAttachmentContext, false);
    assert.ok(!plan.sources.includes("project_files"));
  });

  it("routes what do we carry as catalog with pricebook prefetch", () => {
    const plan = routeCopilotRetrieval("What bullet cameras do we carry that are under $1000");
    assert.ok(plan.sources.includes("pricebook"));
    assert.equal(plan.primarySource, "pricebook");
  });

  it("routes verkada pricebook question as catalog-primary", () => {
    const plan = routeCopilotRetrieval(
      "How much is verkada 365 multi sensor in our pricebook",
      { hasAttachments: true, attachmentCount: 1 },
    );
    assert.ok(plan.sources.includes("pricebook"));
    assert.equal(plan.primarySource, "pricebook");
    assert.equal(plan.loadAttachmentContext, false);
    assert.ok(isPricebookPrimaryPhrase("How much is verkada 365 multi sensor in our pricebook"));
  });

  it("routes RFP schedule question to project files", () => {
    const plan = routeCopilotRetrieval(
      "What quantities are on the device schedule in the RFP?",
      { hasAttachments: true, attachmentCount: 1 },
    );
    assert.ok(plan.sources.includes("project_files"));
    assert.equal(plan.loadAttachmentContext, true);
  });

  it("does not default ambiguous queries to pricebook", () => {
    const plan = routeCopilotRetrieval("hello there");
    assert.ok(!plan.sources.includes("pricebook"));
  });

  it("routes camera manufacturer question with attachment to project files", () => {
    const query =
      "what camera manufacture are they asking for and how many camera devices";
    assert.ok(isAttachmentSpecQuestion(query));
    assert.equal(isPricebookPrimaryPhrase(query), false);
    const plan = routeCopilotRetrieval(query, { hasAttachments: true, attachmentCount: 1 });
    assert.ok(plan.sources.includes("project_files"));
    assert.ok(!plan.sources.includes("pricebook"));
    assert.equal(plan.primarySource, "project_files");
    assert.equal(plan.loadAttachmentContext, true);
    assert.ok(plan.preferStructuredExtractions);
  });

  it("routes local distributor search to external web, not pricebook", () => {
    const query =
      "Okay well then just find me a list of ditributors who carry security products in or lcoal to Ontario CA";
    assert.ok(isExternalWebResearchQuery(query));
    assert.equal(isPricebookPrimaryPhrase(query), false);
    const plan = routeCopilotRetrieval(query, { hasAttachments: true, attachmentCount: 1 });
    assert.deepEqual(plan.sources, []);
    assert.equal(plan.primarySource, null);
    assert.equal(plan.loadAttachmentContext, false);
    const built = buildWebSearchQuery(query);
    assert.match(built, /distributors/i);
    assert.match(built, /California/i);
  });
});

describe("routePricebookCopilotRetrieval", () => {
  it("always routes to pricebook only", () => {
    for (const query of [
      "hello there",
      "Find distributors in Ontario CA",
      "What quantities are on the device schedule?",
      "Bullet cameras under $1000",
    ]) {
      const plan = routePricebookCopilotRetrieval(query);
      assert.deepEqual(plan.sources, ["pricebook"]);
      assert.equal(plan.primarySource, "pricebook");
      assert.equal(plan.loadAttachmentContext, false);
    }
  });
});

describe("shouldLoadPlanAttachmentContext", () => {
  it("skips attachments for pricebook query", () => {
    assert.equal(
      shouldLoadPlanAttachmentContext("How much is verkada in our pricebook", ["a"]),
      false,
    );
  });

  it("loads attachments for camera spec question", () => {
    assert.equal(
      shouldLoadPlanAttachmentContext(
        "what camera manufacture are they asking for and how many camera devices",
        ["a"],
      ),
      true,
    );
  });
});

describe("normalizeCatalogQuery", () => {
  it("strips stop words from verkada query", () => {
    const n = normalizeCatalogQuery(
      "How much is verkada 365 multi sensor in our pricebook",
    );
    assert.ok(n.terms.includes("verkada"));
    assert.ok(n.terms.includes("365"));
    assert.ok(!n.terms.includes("how"));
    assert.ok(!n.terms.includes("much"));
    assert.ok(!n.terms.includes("pricebook"));
    assert.equal(n.manufacturer, "verkada");
  });

  it("matches verkada multisensor product text", () => {
    const productText =
      "verkada four-camera multisensor 365 storage ch52-8tbe-hw verkada";
    const n = normalizeCatalogQuery("verkada 365 multi sensor");
    const score = scoreCatalogMatch(productText, n.terms, {
      manufacturer: "verkada",
      brandField: "Verkada",
    });
    assert.ok(passesCatalogMatchThreshold(score, n.terms.length));
  });
});
