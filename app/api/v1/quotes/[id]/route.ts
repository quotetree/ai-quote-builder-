import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apiKeys/authenticate";
import { hasPermission } from "@/lib/apiKeys/permissions";
import { isUuid, parseQuoteUpdate } from "@/lib/apiKeys/quoteInput";
import { computeQuoteTotals, fitsMoneyColumns } from "@/lib/quote/totals";
import { quoteItemsToSpreadsheetSections } from "@/lib/spreadsheetFromQuote";
import type { QuoteItem } from "@/types/database";

export const runtime = "nodejs";

// DELETE /api/v1/quotes/[id]
// Delete one of the key's organization's quotes. A quote in another
// organization gets the same 404 as one that does not exist.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateApiKey(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // The grant is checked before any table is read
    if (!hasPermission(auth.permissions, "quotes:delete")) {
      return NextResponse.json(
        { error: "This API key is not allowed to delete quotes" },
        { status: 403 }
      );
    }

    // A non-uuid id cannot name a quote, and would otherwise surface as a database error
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    const result = await auth.writes.deleteQuote(id);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    return NextResponse.json({ id }, { status: 200 });
  } catch (error) {
    console.error("Error handling API key request:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/v1/quotes/[id]
// Update any of a quote's name, status, expiration date and items. Sent items
// replace all items and rewrite the quote's linked spreadsheet. A quote held by
// a browser edit session is refused with 409.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateApiKey(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // The grant is checked before the body is parsed or any table is read
    if (!hasPermission(auth.permissions, "quotes:update")) {
      return NextResponse.json(
        { error: "This API key is not allowed to update quotes" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = parseQuoteUpdate(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const input = parsed.value;

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    let totals = null;
    let sheetSections = null;
    if (input.items) {
      totals = computeQuoteTotals(input.items);
      if (!fitsMoneyColumns(totals)) {
        return NextResponse.json({ error: "Quote total is too large" }, { status: 400 });
      }
      // API items never reference a catalog product
      sheetSections = quoteItemsToSpreadsheetSections(
        totals.items.map((item) => ({ ...item, product_id: null })) as unknown as QuoteItem[]
      );
    }

    const result = await auth.writes.updateQuote(id, input, totals, sheetSections);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    if (result.status === "locked") {
      return NextResponse.json(
        {
          error:
            "Quote is locked by a browser edit session. Finish or cancel the edit in the browser, then retry.",
        },
        { status: 409 }
      );
    }
    if (result.status !== "ok") {
      // too_large: stored charges pushed the total past its column
      return NextResponse.json({ error: "Quote total is too large" }, { status: 400 });
    }

    return NextResponse.json(result.quote, { status: 200 });
  } catch (error) {
    console.error("Error handling API key request:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
