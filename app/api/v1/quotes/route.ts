import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apiKeys/authenticate";

export const runtime = "nodejs";

// Explicit projection: a new column on quotes is never published here by accident
const V1_QUOTE_COLUMNS =
  "id, quote_number, quote_name, status, subtotal, tax_amount, total_price, expiration_date, created_at, updated_at";

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
