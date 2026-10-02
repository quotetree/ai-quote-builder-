import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { QuoteWrites, WriteResult } from "./quoteWrites.ts";

// The route files import through the "@/" alias and the real authentication
// module. These hooks resolve the alias, and swap authentication and the
// service client for stubs this file controls through globalThis.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const AUTH_STUB =
  "data:text/javascript,export const authenticateApiKey = (request) => globalThis.__authStub(request);";
const SERVICE_STUB =
  "data:text/javascript,export const getServiceClient = () => globalThis.__serviceStub;";

function resolveTsPath(base: string): string | null {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/apiKeys/authenticate") return { url: AUTH_STUB, shortCircuit: true };
    if (specifier === "@/lib/supabase/service") return { url: SERVICE_STUB, shortCircuit: true };
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      const url = resolveTsPath(ROOT + specifier.slice(2));
      if (url) return { url, shortCircuit: true };
    }
    // Extensionless relative imports, as the bundler allows
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const url = resolveTsPath(fileURLToPath(new URL(specifier, context.parentURL)));
      if (url) return { url, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

type Globals = typeof globalThis & {
  __authStub: (request: Request) => Promise<unknown>;
  __serviceStub: unknown;
};
const globals = globalThis as Globals;

const { NextRequest } = await import("next/server.js");
const collection = await import("../../app/api/v1/quotes/route.ts");
const single = await import("../../app/api/v1/quotes/[id]/route.ts");
const { authenticateApiKey } = await import("./authenticate.ts");

const ORG_ID = "6802279b-048e-4519-b0d6-9683d609d6e6";
const QUOTE_ID = "956466aa-1111-4222-8333-944444444444";
const PROJECT_ID = "7302e2d8-43ec-4998-9ed8-6939f2ea2276";
const ALL_GRANTS = ["quotes:create", "quotes:update", "quotes:delete"];
const SAVED_QUOTE = { id: QUOTE_ID, quote_number: "Q-0003", items: [] };

type WriteCall = { op: keyof QuoteWrites; args: unknown[] };

// A signed-in key with the given grants, whose writes answer with `result`
function signIn(permissions: string[], result: WriteResult | { status: "ok" } | Error = { status: "ok", quote: SAVED_QUOTE }) {
  const calls: WriteCall[] = [];
  const answer = (op: keyof QuoteWrites) => async (...args: unknown[]) => {
    calls.push({ op, args });
    if (result instanceof Error) throw result;
    return result;
  };
  globals.__authStub = async () => ({
    ok: true,
    organizationId: ORG_ID,
    permissions,
    scoped: () => {
      throw new Error("write routes must not read through scoped");
    },
    writes: {
      createQuote: answer("createQuote"),
      updateQuote: answer("updateQuote"),
      deleteQuote: answer("deleteQuote"),
    },
  });
  return calls;
}

function request(method: string, path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const createBody = {
  project_id: PROJECT_ID,
  quote_name: "Roof",
  items: [{ product_name: "Shingles", quantity: 2, unit_price: 10 }],
};

// What the routes compute from createBody's single item
const EXPECTED_TOTALS = {
  items: [
    { product_name: "Shingles", quantity: 2, unit_price: 10, discount_percent: 0, line_total: 20, sort_order: 0 },
  ],
  subtotal: 20,
};

async function send(response: Response) {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  globals.__authStub = async () => {
    throw new Error("signIn was not called");
  };
});

describe("POST /api/v1/quotes", () => {
  it("passes an authentication failure through", async () => {
    globals.__authStub = async () => ({ ok: false, status: 401, error: "Invalid API key" });
    assert.deepEqual(await send(await collection.POST(request("POST", "/api/v1/quotes", createBody))), {
      status: 401,
      body: { error: "Invalid API key" },
    });
  });

  it("refuses a key without quotes:create before reading the body", async () => {
    const calls = signIn(["quotes:update", "quotes:delete"]);
    const res = await send(await collection.POST(request("POST", "/api/v1/quotes", "{not json")));
    assert.deepEqual(res, { status: 403, body: { error: "This API key is not allowed to create quotes" } });
    assert.deepEqual(calls, []);
  });

  it("rejects invalid JSON with 400", async () => {
    const calls = signIn(ALL_GRANTS);
    const res = await send(await collection.POST(request("POST", "/api/v1/quotes", "{not json")));
    assert.equal(res.status, 400);
    assert.deepEqual(calls, []);
  });

  it("rejects an invalid body with the parser's message", async () => {
    const calls = signIn(ALL_GRANTS);
    const res = await send(await collection.POST(request("POST", "/api/v1/quotes", { ...createBody, items: [] })));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /items/);
    assert.deepEqual(calls, []);
  });

  it("rejects a total too large for its column with 400 before writing", async () => {
    const calls = signIn(ALL_GRANTS);
    const items = [{ product_name: "Gold", quantity: 99_999_999.99, unit_price: 9_999_999_999.99 }];
    const res = await send(await collection.POST(request("POST", "/api/v1/quotes", { ...createBody, items })));
    assert.deepEqual(res, { status: 400, body: { error: "Quote total is too large" } });
    assert.deepEqual(calls, []);
  });

  it("returns 404 for a project outside the organization", async () => {
    signIn(ALL_GRANTS, { status: "not_found" });
    assert.deepEqual(await send(await collection.POST(request("POST", "/api/v1/quotes", createBody))), {
      status: 404,
      body: { error: "Project not found" },
    });
  });

  it("returns 201 with the created quote, computing totals from the items", async () => {
    const calls = signIn(ALL_GRANTS);
    const res = await send(await collection.POST(request("POST", "/api/v1/quotes", createBody)));
    assert.deepEqual(res, { status: 201, body: SAVED_QUOTE });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].op, "createQuote");
    const [input, totals] = calls[0].args;
    assert.deepEqual(input, { ...createBody, status: "draft", expiration_date: null });
    assert.deepEqual(totals, EXPECTED_TOTALS);
  });

  it("returns 500 for an outcome create cannot have", async () => {
    signIn(ALL_GRANTS, { status: "locked" });
    assert.equal((await collection.POST(request("POST", "/api/v1/quotes", createBody))).status, 500);
  });

  it("returns 500 when the write throws", async () => {
    signIn(ALL_GRANTS, new Error("database down"));
    assert.deepEqual(await send(await collection.POST(request("POST", "/api/v1/quotes", createBody))), {
      status: 500,
      body: { error: "Internal server error" },
    });
  });
});

describe("PATCH /api/v1/quotes/[id]", () => {
  const patch = (id: string, body: unknown) =>
    single.PATCH(request("PATCH", `/api/v1/quotes/${id}`, body), params(id));

  it("refuses a key without quotes:update before reading the body", async () => {
    const calls = signIn(["quotes:create", "quotes:delete"]);
    assert.deepEqual(await send(await patch(QUOTE_ID, "{not json")), {
      status: 403,
      body: { error: "This API key is not allowed to update quotes" },
    });
    assert.deepEqual(calls, []);
  });

  it("rejects invalid JSON with 400", async () => {
    const calls = signIn(ALL_GRANTS);
    assert.equal((await patch(QUOTE_ID, "{not json")).status, 400);
    assert.deepEqual(calls, []);
  });

  it("returns 404 for a non-uuid id without writing", async () => {
    const calls = signIn(ALL_GRANTS);
    assert.deepEqual(await send(await patch("not-a-uuid", { status: "approved" })), {
      status: 404,
      body: { error: "Quote not found" },
    });
    assert.deepEqual(calls, []);
  });

  it("sends no totals or sheet when items were not sent", async () => {
    const calls = signIn(ALL_GRANTS);
    assert.equal((await patch(QUOTE_ID, { status: "approved" })).status, 200);
    assert.deepEqual(calls[0].args, [QUOTE_ID, { status: "approved" }, null, null]);
  });

  it("sends totals and rebuilt sheet sections when items were sent", async () => {
    const calls = signIn(ALL_GRANTS);
    const res = await send(await patch(QUOTE_ID, { items: createBody.items }));
    assert.deepEqual(res, { status: 200, body: SAVED_QUOTE });
    const [id, input, totals, sections] = calls[0].args as [string, unknown, unknown, { id: string; rows: { id: string }[] }[]];
    assert.equal(id, QUOTE_ID);
    assert.deepEqual(input, { items: createBody.items });
    assert.deepEqual(totals, EXPECTED_TOTALS);
    // Section and row ids are random, so compare everything else
    const withoutIds = sections.map(({ id: _s, ...section }) => ({
      ...section,
      rows: section.rows.map(({ id: _r, ...row }) => row),
    }));
    assert.deepEqual(withoutIds, [
      {
        label: "Line Items",
        rows: [
          {
            custom_label: "",
            product_id: null,
            product_name: "Shingles",
            product_code: "",
            list_price: 10,
            sales_price: 10,
            discount: 0,
            quantity: 2,
          },
        ],
      },
    ]);
  });

  it("returns 404 when the quote is not in the organization", async () => {
    signIn(ALL_GRANTS, { status: "not_found" });
    assert.deepEqual(await send(await patch(QUOTE_ID, { status: "approved" })), {
      status: 404,
      body: { error: "Quote not found" },
    });
  });

  it("returns 409 when a browser edit holds the quote", async () => {
    signIn(ALL_GRANTS, { status: "locked" });
    const res = await send(await patch(QUOTE_ID, { status: "approved" }));
    assert.equal(res.status, 409);
    assert.match(res.body.error, /locked by a browser edit session/);
  });

  it("returns 400 when stored charges push the total past its column", async () => {
    signIn(ALL_GRANTS, { status: "too_large" });
    assert.deepEqual(await send(await patch(QUOTE_ID, { items: createBody.items })), {
      status: 400,
      body: { error: "Quote total is too large" },
    });
  });
});

describe("DELETE /api/v1/quotes/[id]", () => {
  const del = (id: string) => single.DELETE(request("DELETE", `/api/v1/quotes/${id}`), params(id));

  it("refuses a key without quotes:delete", async () => {
    const calls = signIn(["quotes:create", "quotes:update"]);
    assert.deepEqual(await send(await del(QUOTE_ID)), {
      status: 403,
      body: { error: "This API key is not allowed to delete quotes" },
    });
    assert.deepEqual(calls, []);
  });

  it("returns 404 for a non-uuid id without writing", async () => {
    const calls = signIn(ALL_GRANTS);
    assert.equal((await del("not-a-uuid")).status, 404);
    assert.deepEqual(calls, []);
  });

  it("returns 404 when the quote is not in the organization", async () => {
    signIn(ALL_GRANTS, { status: "not_found" });
    assert.deepEqual(await send(await del(QUOTE_ID)), { status: 404, body: { error: "Quote not found" } });
  });

  it("returns 200 with the deleted id", async () => {
    const calls = signIn(ALL_GRANTS, { status: "ok" });
    assert.deepEqual(await send(await del(QUOTE_ID)), { status: 200, body: { id: QUOTE_ID } });
    assert.deepEqual(calls, [{ op: "deleteQuote", args: [QUOTE_ID] }]);
  });
});

describe("authenticateApiKey", () => {
  const KEY = "qt_" + "a".repeat(64);

  function serviceReturning(row: Record<string, unknown>) {
    const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
    globals.__serviceStub = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
        }),
        // The last_used_at stamp
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { data: { status: "not_found" }, error: null };
      },
    };
    return rpcCalls;
  }

  const liveRow = {
    id: "0b6f2a52-6a4c-4c1e-9d0e-6d1a3c1f7e11",
    organization_id: ORG_ID,
    revoked_at: null,
  };

  it("treats a NULL permissions column as read-only", async () => {
    serviceReturning({ ...liveRow, permissions: null });
    const auth = await authenticateApiKey(
      new Request("http://localhost/api/v1/quotes", { headers: { authorization: `Bearer ${KEY}` } })
    );
    assert.equal(auth.ok, true);
    assert.deepEqual((auth as { permissions: string[] }).permissions, []);
  });

  it("binds writes to the key's id and organization from the key row", async () => {
    const rpcCalls = serviceReturning({ ...liveRow, permissions: ["quotes:delete"] });
    const auth = await authenticateApiKey(
      new Request("http://localhost/api/v1/quotes", { headers: { authorization: `Bearer ${KEY}` } })
    );
    assert.equal(auth.ok, true);
    await (auth as { writes: QuoteWrites }).writes.deleteQuote(QUOTE_ID);
    assert.deepEqual(rpcCalls, [
      {
        fn: "api_delete_quote",
        args: { p_organization_id: ORG_ID, p_key_id: liveRow.id, p_quote_id: QUOTE_ID },
      },
    ]);
  });
});
