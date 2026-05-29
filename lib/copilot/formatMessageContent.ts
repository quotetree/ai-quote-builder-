import { sanitizeCopilotLatexBlocks } from "@/lib/copilot/sanitizeCopilotMath";

export interface SourceLink {
  title: string;
  url: string;
}

const TRAILING_SOURCES_PATTERNS = [
  /\r?\n{1,2}(?:#{1,3}\s*)?(?:\*\*)?Sources(?:\*\*)?\s*:?\s*\r?\n[\s\S]*$/i,
  /\r?\n{1,2}(?:\*\*)?Referenced Sources(?:\*\*)?\s*:?\s*\r?\n[\s\S]*$/i,
  /\r?\n{1,2}(?:\*\*)?Web [Ss]ources(?:\*\*)?\s*:?\s*\r?\n[\s\S]*$/i,
];

/** Bare URLs not already inside markdown link syntax */
const BARE_URL_RE = /(?<!\]\()(https?:\/\/[^\s<>\[\]"')]+)/gi;

function trimTrailingPunctuation(url: string): { url: string; suffix: string } {
  const match = url.match(/^(.*?)([.,;:!?)]+)?$/);
  if (!match) return { url, suffix: "" };
  const core = match[1] ?? url;
  const suffix = match[2] ?? "";
  return { url: core, suffix };
}

/** Human-readable label for a URL when the model did not provide link text */
export function deriveLinkLabel(url: string, sources?: SourceLink[]): string {
  const normalized = url.replace(/\/$/, "");
  const fromSource = sources?.find(
    (s) =>
      s.url === url ||
      s.url === normalized ||
      normalized.startsWith(s.url.replace(/\/$/, "")),
  );
  if (fromSource?.title && fromSource.title !== fromSource.url && !fromSource.title.startsWith("http")) {
    return fromSource.title;
  }

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) {
      const base = decodeURIComponent(last.replace(/\.[a-z0-9]+$/i, ""));
      const words = base
        .replace(/[-_+]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
      if (words.length > 2 && words.length < 80) {
        if (/datasheet|spec|catalog|manual|brochure/i.test(words)) return words;
        if (/pdf$/i.test(last)) return `${words} (PDF)`;
        return words;
      }
    }
    const host = parsed.hostname.replace(/^www\./, "");
    const brand = host.split(".")[0];
    if (brand) return `${brand.charAt(0).toUpperCase()}${brand.slice(1)} — View source`;
  } catch {
    /* ignore */
  }
  return "View source";
}

export function stripTrailingSourcesSection(content: string): string {
  let text = content.trimEnd();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of TRAILING_SOURCES_PATTERNS) {
      const next = text.replace(pattern, "").trimEnd();
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }
  return text;
}

export function linkifyBareUrls(content: string, sources?: SourceLink[]): string {
  return content.replace(BARE_URL_RE, (match) => {
    const { url, suffix } = trimTrailingPunctuation(match);
    const label = deriveLinkLabel(url, sources);
    return `[${label}](${url})${suffix}`;
  });
}

/** Internal grounding tags — kept in stored messages for follow-ups, hidden in UI */
const INTERNAL_CITATION_TAG_RE = /\s*\[(?:pricebook|memory|project):[a-f0-9-]+\]\s*/gi;
const INTERNAL_CITATION_LINE_RE = /^\s*\[(?:pricebook|memory|project):[a-f0-9-]+\]\s*$/gim;

export function stripInternalCitationTags(content: string): string {
  return content
    .replace(INTERNAL_CITATION_LINE_RE, "")
    .replace(INTERNAL_CITATION_TAG_RE, " ")
    .replace(/[ \t]+\|/g, " |")
    .replace(/\|[ \t]+\|/g, "| |")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function preprocessCopilotContent(
  content: string,
  options?: {
    sources?: SourceLink[];
    stripSourcesSection?: boolean;
  },
): string {
  let text = content.trim();
  if (options?.stripSourcesSection !== false) {
    text = stripTrailingSourcesSection(text);
  }
  text = stripInternalCitationTags(text);
  text = sanitizeCopilotLatexBlocks(text);
  text = linkifyBareUrls(text, options?.sources);
  return text;
}

export function cleanSourceTitle(title: string, url: string): string {
  const t = title?.trim();
  if (!t || t === url || t.startsWith("http://") || t.startsWith("https://")) {
    return deriveLinkLabel(url);
  }
  return t.replace(/\s+/g, " ");
}
