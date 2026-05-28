export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
}

export interface TavilySearchResponse {
  results: TavilySearchResult[];
  answer?: string;
}

export async function searchWeb(query: string): Promise<TavilySearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("Web search is not configured (TAVILY_API_KEY missing)");
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: true,
    }),
  });

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

export function formatSearchResultsForPrompt(search: TavilySearchResponse): string {
  const lines: string[] = [
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
