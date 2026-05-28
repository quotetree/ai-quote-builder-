import { normalizeUrl } from "@/lib/ai/extractUrlsFromMessage";

export interface FirecrawlScrapeResult {
  url: string;
  title: string;
  markdown: string;
  success: boolean;
  error?: string;
  blocked?: boolean;
}

const DEFAULT_MAX_CHARS = 12_000;

interface FirecrawlApiResponse {
  success?: boolean;
  error?: string;
  data?: {
    markdown?: string;
    metadata?: {
      title?: string;
      sourceURL?: string;
      ogTitle?: string;
    };
  };
}

export async function scrapePage(url: string): Promise<FirecrawlScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return {
      url,
      title: url,
      markdown: "",
      success: false,
      error: "Firecrawl is not configured (FIRECRAWL_API_KEY missing)",
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      url,
      title: url,
      markdown: "",
      success: false,
      error: "Invalid URL",
    };
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return {
      url,
      title: url,
      markdown: "",
      success: false,
      error: "Only http and https URLs are supported",
    };
  }

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: parsedUrl.href,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 45000,
      }),
    });

    const body = (await res.json()) as FirecrawlApiResponse;

    if (!res.ok) {
      const errMsg = body.error ?? `HTTP ${res.status}`;
      const blocked =
        res.status === 403 ||
        /blocked|robots|forbidden|denied/i.test(errMsg);
      return {
        url: parsedUrl.href,
        title: parsedUrl.hostname,
        markdown: "",
        success: false,
        error: errMsg,
        blocked,
      };
    }

    if (!body.success || !body.data?.markdown?.trim()) {
      const errMsg =
        body.error ??
        "No extractable content returned (page may be blocked, empty, or require login)";
      return {
        url: parsedUrl.href,
        title: body.data?.metadata?.title ?? parsedUrl.hostname,
        markdown: "",
        success: false,
        error: errMsg,
        blocked: /blocked|robots|forbidden/i.test(errMsg),
      };
    }

    const meta = body.data.metadata;
    const title =
      meta?.title?.trim() ||
      meta?.ogTitle?.trim() ||
      meta?.sourceURL?.trim() ||
      parsedUrl.hostname;

    return {
      url: meta?.sourceURL ?? parsedUrl.href,
      title,
      markdown: body.data.markdown.trim(),
      success: true,
    };
  } catch (err) {
    return {
      url: parsedUrl.href,
      title: parsedUrl.hostname,
      markdown: "",
      success: false,
      error: err instanceof Error ? err.message : "Scrape request failed",
    };
  }
}

export function truncateMarkdown(markdown: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  if (markdown.length <= maxChars) return markdown;
  return (
    markdown.slice(0, maxChars).trimEnd() +
    `\n\n… [content truncated to ${maxChars.toLocaleString()} characters for context limits]`
  );
}

export function formatScrapeForPrompt(
  result: FirecrawlScrapeResult,
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  if (!result.success) {
    const blockedNote = result.blocked
      ? " The site may block automated access (robots/login)."
      : "";
    return [
      `Page read failed for ${result.url}.`,
      `Error: ${result.error ?? "unknown"}${blockedNote}`,
      "Fall back to Tavily search snippets if you ran web_search, or tell the user this page could not be extracted.",
    ].join("\n");
  }

  const content = truncateMarkdown(result.markdown, maxChars);
  return [
    `### ${result.title}`,
    `Source URL: ${result.url}`,
    "",
    content,
  ].join("\n");
}

export interface CachedScrape {
  formatted: string;
  result: FirecrawlScrapeResult;
}

export type ScrapeCache = Map<string, CachedScrape>;

export function cacheKey(url: string): string {
  return normalizeUrl(url);
}

export async function scrapePageCached(
  url: string,
  cache: ScrapeCache,
  maxChars: number = DEFAULT_MAX_CHARS,
): Promise<CachedScrape> {
  const key = cacheKey(url);
  const cached = cache.get(key);
  if (cached) return cached;

  const result = await scrapePage(url);
  const formatted = formatScrapeForPrompt(result, maxChars);
  const entry = { formatted, result };
  cache.set(key, entry);
  return entry;
}
