import type { BuildAnalyzeResult } from "@/lib/applyBuildUpdates";

/** User is requesting new line items — don't auto-treat as spreadsheet updates. */
export function messageRequestsNewItems(message: string): boolean {
  return (
    /\b(i need|add|include|get|quote)\b/i.test(message) ||
    /\$\s*[\d,]+(?:\.\d+)?\s*(?:in\s+)?\w*\s*labor\b/i.test(message)
  );
}

export function shouldDiscardUpdatesForNewItemRequest(
  message: string,
  analyze: BuildAnalyzeResult,
): boolean {
  if (analyze.explicitAdds.length > 0) return false;
  if (analyze.updates.length === 0) return false;
  return messageRequestsNewItems(message);
}

export function resolveAnalyzeForRouting(
  message: string,
  analyze: BuildAnalyzeResult,
): BuildAnalyzeResult {
  if (!shouldDiscardUpdatesForNewItemRequest(message, analyze)) return analyze;

  return {
    ...analyze,
    intent: "add",
    updates: [],
  };
}
