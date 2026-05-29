import { parseTotalsFromFormattedVision } from "@/lib/ai/plan/floorPlanVision";
import { formatSearchResultsForPrompt, mergeTavilySearches, searchWeb } from "@/lib/ai/tavilySearch";

export interface PlanLayoutResearchPrefetch {
  webBlock: string;
  webSources: { title: string; url: string }[];
}

function extractCameraStylesWithCounts(floorPlanAnalysis: string): string[] {
  const counts = parseTotalsFromFormattedVision(floorPlanAnalysis);
  const styles: string[] = [];
  if (counts.fisheye > 0) styles.push("fisheye");
  if (counts.multisensor > 0) styles.push("multisensor");
  if (counts.dome > 0) styles.push("dome");
  if (styles.length === 0 && counts.total > 0) {
    styles.push("dome", "multisensor");
  }
  return styles;
}

function extractBrand(floorPlanAnalysis: string, userMessage: string): string | null {
  const corpus = `${floorPlanAnalysis}\n${userMessage}`;
  if (/\bverkada\b/i.test(corpus)) return "Verkada";
  if (/\bhanwha\b/i.test(corpus)) return "Hanwha Vision";
  if (/\baxis\b/i.test(corpus)) return "Axis";
  return null;
}

function buildWebQueries(
  styles: string[],
  brand: string | null,
  userMessage: string,
): string[] {
  const brandPrefix = brand ? `${brand} ` : "";
  const queries: string[] = [];

  for (const style of styles.slice(0, 4)) {
    queries.push(
      `${brandPrefix}${style} camera specifications resolution indoor commercial install datasheet`,
    );
  }

  if (/\bquote|quoting|each location|per location\b/i.test(userMessage)) {
    queries.push(
      `${brandPrefix}security camera model guide ${styles.join(" ")} which model to use`,
    );
  }

  return [...new Set(queries)].slice(0, 3);
}

/**
 * After floor-plan vision counts, prefetch Tavily product research per camera style.
 */
export async function prefetchPlanLayoutResearch(
  userMessage: string,
  floorPlanAnalysisBlock: string,
): Promise<PlanLayoutResearchPrefetch> {
  const styles = extractCameraStylesWithCounts(floorPlanAnalysisBlock);
  const brand = extractBrand(floorPlanAnalysisBlock, userMessage);

  const webSources: { title: string; url: string }[] = [];
  let webBlock = "";

  if (process.env.TAVILY_API_KEY) {
    try {
      const queries = buildWebQueries(styles, brand, userMessage);
      const searches = await Promise.all(
        queries.map((q) => searchWeb(q, { searchDepth: "basic", maxResults: 6 })),
      );
      const merged = mergeTavilySearches(searches);
      for (const r of merged.results) {
        if (r.url) webSources.push({ title: r.title, url: r.url });
      }
      webBlock = [
        "--- MANUFACTURER / PRODUCT RESEARCH (pre-loaded Tavily) ---",
        `Styles on this plan (from vision counts): ${styles.join(", ") || "see floor plan totals"}.`,
        "Use for model names and specs — do not change camera counts from the floor plan analysis.",
        formatSearchResultsForPrompt(merged, { preferSnippetsOnly: true }),
      ].join("\n\n");
    } catch {
      webBlock =
        "--- MANUFACTURER RESEARCH ---\nTavily prefetch failed. Call web_search for styles listed in floor plan totals only.";
    }
  } else {
    webBlock =
      "--- MANUFACTURER RESEARCH ---\nTAVILY_API_KEY not set. Call web_search if available or state limitation.";
  }

  return { webBlock, webSources };
}
