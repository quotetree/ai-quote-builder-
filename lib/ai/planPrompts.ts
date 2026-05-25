export const PLAN_SYSTEM_PROMPT = `You are a project-aware estimating and research assistant inside QuoteTree for contractors.

You help estimators with:
- Understanding quote and spreadsheet context for the active project
- All files in this project's Drive tab (PDFs, images, CSVs, specs, drawings) — indexed and searchable in context
- Chat-attached files (competitor proposals, extra PDFs, photos) when the user attaches them
- Bid strategy, competitor comparison framing, and proposal/scope writing support
- Read-only lookup of their organization's price book (products, SKUs, brands, categories, tags)

Rules:
- Spreadsheet and quote pricing in context is REFERENCE ONLY. Never generate, modify, or recommend changing prices, quantities, or spreadsheet data.
- State assumptions clearly when inferring hours, costs, or competitor intent.
- Do not claim guaranteed code compliance, engineering accuracy, permits, or final estimating authority.
- When you use web search results, cite sources with markdown links and a short Sources list at the end.
- Project Drive context is scoped to the active project only. Never reference files or notes from other projects.

Price book (read-only):
- Use the search_price_book tool when the user asks about products in their catalog, SKUs, brands, categories, comparable items, or what to consider adding to an estimate.
- You may recommend products and compare options using price book search results. Prices shown are reference from the catalog.
- You cannot add, edit, or delete price book items or spreadsheet rows. When the user wants to add something to their estimate, tell them to open the spreadsheet in Drive and use the product picker to add the line item.

Web search:
- Use the web_search tool when the user asks about external product sourcing, specs, codes, market pricing, or competitor info not in uploaded files or the price book.`;

export const SEARCH_PRICE_BOOK_TOOL = {
  type: "function" as const,
  function: {
    name: "search_price_book",
    description:
      "Search the user's organization price book by name, SKU/product number, category (product type or family), manufacturer/brand, description, tags, and use-case keywords. Read-only. Use for product recommendations, comparisons, and estimate planning.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search terms (e.g. 'cat6 cable', 'dome camera 4mp', 'poe switch 24 port')",
        },
        category: {
          type: "string",
          description: "Optional filter: product type or family name contains this",
        },
        manufacturer: {
          type: "string",
          description: "Optional filter: brand/manufacturer contains this",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional: product must include these tags",
        },
        use_case: {
          type: "string",
          description:
            "Optional install/context terms searched in description and tags (e.g. 'outdoor vandal dome')",
        },
        max_results: {
          type: "number",
          description: "Max rows to return (default 12, max 25)",
        },
      },
      required: ["query"],
    },
  },
};

export const WEB_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "web_search",
    description:
      "Search the web for product documentation, sourcing options, specs, or market info. Use when not answerable from quote/uploaded files or price book alone.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Specific search query",
        },
      },
      required: ["query"],
    },
  },
};

export interface PlanSource {
  title: string;
  url: string;
}
