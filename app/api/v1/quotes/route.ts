import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apiKeys/authenticate";
import { hasPermission } from "@/lib/apiKeys/permissions";
import { parseQuoteCreate } from "@/lib/apiKeys/quoteInput";
import { V1_QUOTE_COLUMNS } from "@/lib/apiKeys/v1Quote";
import { computeQuoteTotals, fitsMoneyColumns } from "@/lib/quote/totals";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseNonNegativeInt(value: string | null): number | null {
  if (value === null) return null;
  return /^\d+$/.test(value) ? Number(value) : NaN;
}

// GET /api/v1/quotes
// List the key's organization's quotes, newest first, paged by limit/offset.
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const searchParams = request.nextUrl.searchParams;
    const limitParam = parseNonNegativeInt(searchParams.get("limit"));
    const offsetParam = parseNonNegativeInt(searchParams.get("offset"));

    const limit = limitParam ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return NextResponse.json(
        { error: `limit must be an integer from 1 to ${MAX_LIMIT}` },
        { status: 400 }
      );
    }

    const offset = offsetParam ?? 0;
    if (!Number.isInteger(offset)) {
      return NextResponse.json(
        { error: "offset must be an integer of 0 or more" },
        { status: 400 }
      );
    }

    // Fetch one extra row to decide has_more without a count query
    const { data, error } = await auth
      .scoped("quotes", V1_QUOTE_COLUMNS)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit);

    if (error) {
      console.error("Failed to read quotes for API key request:", error);
      return NextResponse.json({ error: "Unable to read quotes" }, { status: 500 });
    }

    const rows = data ?? [];
    const has_more = rows.length > limit;
    return NextResponse.json({ quotes: rows.slice(0, limit), limit, offset, has_more });
  } catch (error) {
    console.error("Error handling API key request:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/v1/quotes
// Create a quote with its items in one of the key's organization's projects.
// A project in another organization gets the same 404 as one that does not exist.
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // The grant is checked before the body is parsed or any table is read
    if (!hasPermission(auth.permissions, "quotes:create")) {
      return NextResponse.json(
        { error: "This API key is not allowed to create quotes" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = parseQuoteCreate(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const totals = computeQuoteTotals(parsed.value.items);
    if (!fitsMoneyColumns(totals)) {
      return NextResponse.json({ error: "Quote total is too large" }, { status: 400 });
    }

    const result = await auth.writes.createQuote(parsed.value, totals);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (result.status !== "ok") {
      throw new Error(`Unexpected create outcome: ${result.status}`);
    }

    return NextResponse.json(result.quote, { status: 201 });
  } catch (error) {
    console.error("Error handling API key request:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
