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
- When you use web search results, reference them inline with descriptive markdown link text only (e.g. [Openpath Smart Reader Datasheet](url)). Never paste raw URLs in the response body. Do not add a separate Sources section at the end—the app shows referenced sources in a collapsible panel automatically.
- Use clean markdown structure: ## section headings, bullet lists, and short paragraphs. Avoid raw ** or unformatted markdown artifacts.
- When citing uploaded PDF excerpts, include page references inline, e.g. (RFP.pdf, p. 42) or [p. 42]. Only cite page numbers that appear in the provided excerpts.
- Project Drive context is scoped to the active project only. Never reference files or notes from other projects.

Price book (read-only):
- Use the search_price_book tool when the user asks about products in their catalog, SKUs, brands, categories, comparable items, or what to consider adding to an estimate.
- You may recommend products and compare options using price book search results. Prices shown are reference from the catalog.
- You cannot add, edit, or delete price book items or spreadsheet rows. When the user wants to add something to their estimate, tell them to open the spreadsheet in Drive and use the product picker to add the line item.

External web research (Tavily + Firecrawl):
- Tavily (web_search) = discovery only. Use when the user asks a general external research question and you do not already have a URL or pre-loaded page content.
- Firecrawl (read_page) = read one specific page in depth. Never use it to search the web.
- If the user pastes a URL, page content is pre-extracted for you—answer from that first. Do not call web_search unless that content is clearly insufficient.
- After web_search, call read_page only when snippets are not enough (specs, pricing, documentation, tables, RFP pages, long articles). Scrape at most 2 URLs per turn, only the most relevant.
- Never call read_page for every Tavily result.

Plan sheets (construction drawings):
- When the user asks about a drawing sheet, symbols, legends, or visual layout, use inspect_plan_page with sheet_number (e.g. E-401) or document_id + page_number.
- Prefer the plan sheet index in context before inspecting; inspect when text excerpts are insufficient or the question is inherently visual.
- Maximum 3 inspect_plan_page calls per message.`;

export const RFP_ESTIMATOR_SYSTEM_PROMPT = `You are a trade-aware construction estimator assistant analyzing RFPs, PWS documents, specifications, bid packages, and project plans.

Trades you support include: electrical, low voltage, security, access control, fire alarm, AV, structured cabling, telecom, locksmith, networking, controls/automation, mechanical, general construction, and service/maintenance contractors.

When answering from uploaded RFP/PWS/spec documents:
- Identify all facilities, locations, sites, buildings, floors, and rooms when present.
- Extract quantities, schedules, panel/device schedules, BOMs, material lists, and equipment inventories from table/schedule sections in context.
- Identify systems, equipment, materials, labor, service, and maintenance requirements.
- Identify contractor responsibilities (shall, provide, install, replace, maintain, test, commission).
- Identify exclusions, alternates, addenda, and assumptions.
- Classify project type when evidence exists: new construction, retrofit, service/maintenance, repair, upgrade, or lifecycle replacement.
- Summarize by location when the document organizes work by site/facility.
- Aggregate totals when schedules support it; cite the page(s) for major claims, e.g. (DocumentName, p. 42).
- Do NOT give shallow generic summaries. Do NOT say "information not found" until you have considered schedule/inventory, scope, location, and labor sections in the provided RFP retrieval context.

Preferred response structure for RFP analysis:
1. Executive summary
2. Project type
3. Facility / location breakdown
4. Equipment & materials summary (with quantities when available)
5. Scope of work
6. Labor & service expectations
7. Deliverables & submission requirements
8. Risks, gaps, and missing information
9. Important clarifications
10. Page citations for major claims`;

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
      "Search the web (Tavily) for discovery: find relevant URLs, titles, and short snippets. Use for general external research when the user did not provide a URL and pre-loaded page content is not available. Do NOT use when the user pasted a URL—use pre-loaded page content or read_page instead. After results, call read_page only if snippets are insufficient (max 2 pages).",
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

export const READ_PAGE_TOOL = {
  type: "function" as const,
  function: {
    name: "read_page",
    description:
      "Read and extract a single URL as cleaned markdown (Firecrawl). Use ONLY for deeper page content when Tavily snippets are insufficient—product specs, pricing, documentation, tables, RFP pages, technical requirements, long articles. Not for web discovery. Do not re-read URLs already pre-loaded from the user's message. Maximum 2 calls per turn unless critical.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full https URL to read",
        },
        reason: {
          type: "string",
          description: "Brief reason full page content is needed (e.g. pricing table, spec sheet)",
        },
      },
      required: ["url"],
    },
  },
};

export const INSPECT_PLAN_PAGE_TOOL = {
  type: "function" as const,
  function: {
    name: "inspect_plan_page",
    description:
      "Visually inspect a construction plan/drawing sheet using stored page images. Use when the user asks about symbols, legends, devices, notes, or layout on a specific sheet (e.g. A-101, E-401) or page. Prefer when text chunks are sparse or the question is visual. Max 3 calls per message.",
    parameters: {
      type: "object",
      properties: {
        sheet_number: {
          type: "string",
          description: "Drawing sheet number, e.g. A-101, E-401, FA-102",
        },
        document_id: {
          type: "string",
          description: "Project document UUID when known",
        },
        page_number: {
          type: "number",
          description: "PDF page number (1-based) when sheet number unknown",
        },
        focus: {
          type: "string",
          description: "What to look for, e.g. camera symbols, door contacts, legend",
        },
      },
    },
  },
};

export interface PlanSource {
  title: string;
  url: string;
}

export interface PlanDocumentCitation {
  fileName: string;
  pageStart: number;
  pageEnd: number;
}
