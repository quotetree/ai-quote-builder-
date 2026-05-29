import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCatalogSearchQuery } from "@/lib/ai/plan/catalogConversation";
import type { ChatTurn } from "@/lib/ai/plan/webResearchContext";
import {
  resolveReferentialFollowUp,
} from "@/lib/ai/pricebookCopilot/referentialFollowUp";
import { normalizeCatalogQuery } from "@/lib/ai/retrieval/catalogQueryNormalize";
import {
  CATALOG_LIST_ALL_CAP,
  enrichCatalogFiltersFromTerms,
  parseCatalogQueryFilters,
} from "@/lib/ai/retrieval/catalogQueryFilters";
import {
  fetchPriceBookProductsByIds,
  formatPinnedResultSetForPrompt,
  formatPriceBookResultsForPrompt,
  mergeCatalogFilters,
  searchPriceBook,
} from "@/lib/ai/searchPriceBook";

const MANDATORY_HEADER = `--- PRICE BOOK SEARCH (ran on your full catalog — authoritative) ---
The rows below are the **only** products you may list. Copy **exact** product name, SKU, and **Sales (catalog)** price from a row.
**Forbidden:** Inventing models (e.g. Verkada D30/B30/C20, V-D30), MSRP from the web, or any product without a \`[pricebook:uuid]\` tag from this list.`;

const EMPTY_CATALOG = `${MANDATORY_HEADER}

**Zero rows matched** after multi-stage catalog search (normalization, category expansion, partial token, semantic).

**Do NOT** reply with a generic apology. Instead:
1. Acknowledge the search covered the full price book
2. Suggest refining by SKU, brand, or broader category term
3. Offer to search a related category if the user's term may be too narrow (e.g. "cables" → patch panels, structured cabling)
**Do not invent products or prices.**`;

/**
 * Always run a full catalog search before the LLM turn for price-book questions.
 * Prevents the model from answering from training data when it skips search_price_book.
 */
export async function runMandatoryCatalogSearch(
  supabase: SupabaseClient,
  organizationId: string,
  userMessage: string,
  history: ChatTurn[] = [],
): Promise<string> {
  const referential = resolveReferentialFollowUp(userMessage, history);
  if (referential) {
    const pinned = await fetchPriceBookProductsByIds(
      supabase,
      organizationId,
      referential.productIds,
    );
    return formatPinnedResultSetForPrompt(pinned, {
      priorLabel: referential.priorResultLabel,
      userQuestion: userMessage,
    });
  }

  const searchQuery = buildCatalogSearchQuery(userMessage, history);
  const normalized = normalizeCatalogQuery(searchQuery);
  const parsed = enrichCatalogFiltersFromTerms(
    parseCatalogQueryFilters(searchQuery),
    normalized.terms,
  );

  if (parsed.manufacturer) {
    parsed.listAll = true;
  }

  const { params } = mergeCatalogFilters(
    {
      query: normalized.searchText || searchQuery,
      manufacturer: parsed.manufacturer ?? normalized.manufacturer,
      category: parsed.categoryHint,
      max_sales_price: parsed.maxSalesPrice,
      min_sales_price: parsed.minSalesPrice,
      max_results: CATALOG_LIST_ALL_CAP,
    },
    searchQuery,
    normalized.terms,
  );

  const search = await searchPriceBook(
    supabase,
    {
      ...params,
      manufacturer: params.manufacturer ?? normalized.manufacturer ?? parsed.manufacturer,
    },
    { organizationId },
  );

  if (search.match_count === 0) {
    return EMPTY_CATALOG;
  }

  return `${MANDATORY_HEADER}\n\n${formatPriceBookResultsForPrompt(search)}`;
}
