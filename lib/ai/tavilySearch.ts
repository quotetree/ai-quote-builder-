export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
}

export interface TavilySearchResponse {
  results: TavilySearchResult[];
  answer?: string;
}

export interface SearchWebOptions {
  searchDepth?: "basic" | "advanced";
  maxResults?: number;
}

const TAVILY_TIMEOUT_MS = 18_000;

export async function searchWeb(
  query: string,
  options: SearchWebOptions = {},
): Promise<TavilySearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("Web search is not configured (TAVILY_API_KEY missing)");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: options.searchDepth ?? "basic",
        max_results: options.maxResults ?? 5,
        include_answer: true,
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Web search timed out — try a narrower query");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tavily search failed: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
    answer?: string;
  };

  return {
    results: (data.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "Source",
      url: r.url ?? "",
      content: r.content ?? "",
    })),
    answer: data.answer,
  };
}

export function formatSearchResultsForPrompt(
  search: TavilySearchResponse,
  options?: { preferSnippetsOnly?: boolean },
): string {
  const lines: string[] = options?.preferSnippetsOnly
    ? [
        "Tavily web search results. Answer from these snippets and summaries — do NOT call read_page unless a critical fact is missing.",
      ]
    : [
        "Tavily web search results (snippets only). If snippets are enough, answer without reading full pages.",
        "If you need specs, pricing, documentation, tables, or long-form detail, call read_page for at most 2 of the most relevant URLs below—not every result.",
      ];
  if (search.answer) {
    lines.push(`\nSummary: ${search.answer}`);
  }
  for (const r of search.results) {
    lines.push(`- **${r.title}** (${r.url}): ${r.content.slice(0, 500)}`);
  }
  return lines.join("\n");
}

export function mergeTavilySearches(searches: TavilySearchResponse[]): TavilySearchResponse {
  const seen = new Set<string>();
  const results: TavilySearchResult[] = [];
  const answers: string[] = [];

  for (const search of searches) {
    if (search.answer) answers.push(search.answer);
    for (const r of search.results) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      results.push(r);
    }
  }

  return {
    results,
    answer: answers.length > 0 ? answers.join("\n\n") : undefined,
  };
}
