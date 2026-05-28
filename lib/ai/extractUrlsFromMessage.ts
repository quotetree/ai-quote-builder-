const URL_RE = /https?:\/\/[^\s<>\[\]"')]+/gi;

function trimTrailingPunctuation(raw: string): string {
  return raw.replace(/[.,;:!?)]+$/, "");
}

/** Extract unique http(s) URLs from user text, in order of appearance. */
export function extractUrlsFromText(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of text.matchAll(URL_RE)) {
    const trimmed = trimTrailingPunctuation(match[0]);
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      const normalized = normalizeUrl(parsed.href);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(parsed.href);
      }
    } catch {
      /* skip invalid */
    }
  }

  return urls;
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const href = parsed.href;
    return href.endsWith("/") && parsed.pathname !== "/" ? href.slice(0, -1) : href;
  } catch {
    return url.trim();
  }
}
