import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createQuoteWrites } from "./quoteWrites.ts";
import { SPREADSHEET_QUOTE_SCOPE } from "../spreadsheetFromQuote.ts";
import type { QuoteTotals } from "../quote/totals.ts";

const ORG_ID = "6802279b-048e-4519-b0d6-9683d609d6e6";
const KEY_ID = "0b6f2a52-6a4c-4c1e-9d0e-6d1a3c1f7e11";
const QUOTE_ID = "956466aa-1111-4222-8333-944444444444";
const PROJECT_ID = "7302e2d8-43ec-4998-9ed8-6939f2ea2276";

type RpcCall = { fn: string; args: Record<string, unknown> };

// Records each rpc call and answers with the next queued response
function fakeService(responses: { data?: unknown; error?: unknown }[]) {
  const calls: RpcCall[] = [];
  const svc = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const next = responses.shift() ?? {};
      return Promise.resolve({ data: next.data ?? null, error: next.error ?? null });
    },
  };
  return { svc: svc as never, calls };
}

const totals: QuoteTotals = {
  items: [
    {
      product_name: "Shingles",
      quantity: 2,
      unit_price: 10,
      discount_percent: 0,
      line_total: 20,
      sort_order: 0,
    },
  ],
  subtotal: 20,
};

const okResult = {
  status: "ok",
  quote: {
    id: QUOTE_ID,
    quote_number: "Q-0003",
    quote_name: "Roof",
    status: "draft",
    subtotal: 20,
    tax_amount: 0,
    total_price: 20,
    expiration_date: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    organization_id: ORG_ID,
    user_id: "owner",
  },
  items: [{ id: "item-1", product_name: "Shingles", quote_id: QUOTE_ID }],
};

describe("createQuoteWrites", () => {
  let logged: string[];
  const originalLog = console.log;

  beforeEach(() => {
    logged = [];
    console.log = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  describe("createQuote", () => {
    it("pins the key's organization, key id and the spreadsheet marker", async () => {
      const { svc, calls } = fakeService([{ data: okResult }]);
      const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });

      await writes.createQuote(
        { project_id: PROJECT_ID, quote_name: "Roof", status: "draft", expiration_date: null, items: [] },
        totals
      );

      assert.equal(calls.length, 1);
      assert.equal(calls[0].fn, "api_create_quote");
      assert.deepEqual(calls[0].args, {
        p_organization_id: ORG_ID,
        p_key_id: KEY_ID,
        p_project_id: PROJECT_ID,
        p_quote_name: "Roof",
        p_status: "draft",
        p_expiration_date: null,
        p_scope_of_work: SPREADSHEET_QUOTE_SCOPE,
        p_items: totals.items,
        p_subtotal: 20,
      });
    });

    it("returns the projected quote on ok, without internal columns", async () => {
      const { svc } = fakeService([{ data: okResult }]);
      const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });

      const result = await writes.createQuote(
        { project_id: PROJECT_ID, quote_name: "Roof", status: "draft", expiration_date: null, items: [] },
        totals
      );

      assert.equal(result.status, "ok");
      const quote = (result as { quote: Record<string, unknown> }).quote;
      assert.equal(quote.id, QUOTE_ID);
      assert.equal("organization_id" in quote, false);
      assert.equal("user_id" in quote, false);
      assert.deepEqual(quote.items, [{ id: "item-1", product_name: "Shingles" }]);
    });

    it("maps not_found", async () => {
      const { svc } = fakeService([{ data: { status: "not_found" } }]);
      const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });

      const result = await writes.createQuote(
        { project_id: PROJECT_ID, quote_name: "Roof", status: "draft", expiration_date: null, items: [] },
        totals
      );
      assert.deepEqual(result, { status: "not_found" });
    });
  });

  describe("updateQuote", () => {
    it("sends only the fields the request sent, and null items when none were sent", async () => {
      const { svc, calls } = fakeService([{ data: okResult }]);
      const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });

      await writes.updateQuote(QUOTE_ID, { status: "approved" }, null, null);

      assert.equal(calls[0].fn, "api_update_quote");
      assert.deepEqual(calls[0].args, {
        p_organization_id: ORG_ID,
        p_key_id: KEY_ID,
        p_quote_id: QUOTE_ID,
        p_fields: { status: "approved" },
        p_items: null,
        p_subtotal: null,
        p_sheet_sections: null,
      });
    });

    it("sends items, subtotal and sheet sections when items were sent", async () => {
      const { svc, calls } = fakeService([{ data: okResult }]);
      const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });
      const sections = [{ id: "s1" }];

      await writes.updateQuote(
        QUOTE_ID,
        { quote_name: "Roof", expiration_date: "2026-12-31", items: [] },
        totals,
        sections
      );

      assert.deepEqual(calls[0].args.p_fields, { quote_name: "Roof", expiration_date: "2026-12-31" });
      assert.equal(calls[0].args.p_items, totals.items);
      assert.equal(calls[0].args.p_subtotal, 20);
      assert.equal(calls[0].args.p_sheet_sections, sections);
    });

    for (const status of ["not_found", "locked", "too_large"] as const) {
      it(`maps ${status}`, async () => {
        const { svc } = fakeService([{ data: { status } }]);
        const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });

        assert.deepEqual(await writes.updateQuote(QUOTE_ID, { status: "draft" }, null, null), { status });
      });
    }

    it("throws on an unrecognized status", async () => {
      const { svc } = fakeService([{ data: { status: "weird" } }]);
      const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });

      await assert.rejects(
        writes.updateQuote(QUOTE_ID, { status: "draft" }, null, null),
        /Quote update function returned an unrecognized status: weird/
      );
    });

    it("rethrows an rpc error", async () => {
      const rpcError = { message: "boom", code: "XX000" };
      const { svc } = fakeService([{ error: rpcError }]);
      const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });

      await assert.rejects(writes.updateQuote(QUOTE_ID, { status: "draft" }, null, null), (err) => {
        assert.equal(err, rpcError);
        return true;
      });
    });
  });

  describe("deleteQuote", () => {
    it("deletes through the organization-pinned function", async () => {
      const { svc, calls } = fakeService([{ data: { status: "ok" } }]);
      const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });

      assert.deepEqual(await writes.deleteQuote(QUOTE_ID), { status: "ok" });
      assert.deepEqual(calls, [
        {
          fn: "api_delete_quote",
          args: { p_organization_id: ORG_ID, p_key_id: KEY_ID, p_quote_id: QUOTE_ID },
        },
      ]);
    });

    it("maps not_found", async () => {
      const { svc } = fakeService([{ data: { status: "not_found" } }]);
      const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });

      assert.deepEqual(await writes.deleteQuote(QUOTE_ID), { status: "not_found" });
    });

    it("throws on an unrecognized status", async () => {
      const { svc } = fakeService([{ data: null }]);
      const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });

      await assert.rejects(writes.deleteQuote(QUOTE_ID), /unrecognized status/);
    });

    it("rethrows an rpc error", async () => {
      const rpcError = { message: "boom" };
      const { svc } = fakeService([{ error: rpcError }]);
      const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });

      await assert.rejects(writes.deleteQuote(QUOTE_ID), (err) => err === rpcError);
    });
  });

  describe("write log", () => {
    it("logs one line per write naming the key id and outcome", async () => {
      const { svc } = fakeService([{ data: okResult }, { data: { status: "locked" } }, { error: { message: "x" } }]);
      const writes = createQuoteWrites(svc, { keyId: KEY_ID, organizationId: ORG_ID });

      await writes.createQuote(
        { project_id: PROJECT_ID, quote_name: "Roof", status: "draft", expiration_date: null, items: [] },
        totals
      );
      await writes.updateQuote(QUOTE_ID, { status: "draft" }, null, null);
      await writes.deleteQuote(QUOTE_ID).catch(() => {});

      const entries = logged.map((line) => {
        assert.match(line, /^\[api-keys\] write /);
        return JSON.parse(line.replace("[api-keys] write ", ""));
      });
      assert.deepEqual(entries, [
        { keyId: KEY_ID, organizationId: ORG_ID, action: "create", quoteId: QUOTE_ID, outcome: "ok" },
        { keyId: KEY_ID, organizationId: ORG_ID, action: "update", quoteId: QUOTE_ID, outcome: "locked" },
        { keyId: KEY_ID, organizationId: ORG_ID, action: "delete", quoteId: QUOTE_ID, outcome: "error" },
      ]);
    });
  });
});
