import type { ChatTurn } from "@/lib/ai/plan/webResearchContext";

export type PricebookTaskComplexity = "simple" | "standard" | "deep";

export function dedupeHistoryCurrentMessage(
  history: ChatTurn[],
  currentMessage: string,
): ChatTurn[] {
  const trimmed = currentMessage.trim();
  if (history.length === 0) return history;
  const last = history[history.length - 1];
  if (last.role === "user" && last.content.trim() === trimmed) {
    return history.slice(0, -1);
  }
  return history;
}

export function trimChatHistory(
  history: ChatTurn[],
  options: { maxTurns?: number; maxAssistantChars?: number } = {},
): ChatTurn[] {
  const maxTurns = options.maxTurns ?? 12;
  const maxAssistantChars = options.maxAssistantChars ?? 2800;
  const sliced = history.slice(-maxTurns);

  return sliced.map((m, i) => {
    const isLastAssistant =
      m.role === "assistant" && !sliced.slice(i + 1).some((x) => x.role === "assistant");
    if (m.role !== "assistant" || isLastAssistant || m.content.length <= maxAssistantChars) {
      return m;
    }
    return {
      ...m,
      content: `${m.content.slice(0, maxAssistantChars)}\n\n[Earlier reply truncated.]`,
    };
  });
}

export function assessPricebookTaskComplexity(userMessage: string): PricebookTaskComplexity {
  const msg = userMessage.trim();

  if (
    msg.length < 100 &&
    (/\bhow much\b/i.test(msg) ||
      /\bdo we (?:carry|stock|sell)\b/i.test(msg) ||
      /\bprice of\b/i.test(msg))
  ) {
    return "simple";
  }

  if (
    /\b(compare|margin|markup|profit|total|estimate|all\b|every\b|list\b|filter\b|under \$|over \$)/i.test(
      msg,
    )
  ) {
    return "deep";
  }

  return "standard";
}

export function pricebookTurnInstructions(
  complexity: PricebookTaskComplexity,
  turnNumber: number,
): string {
  const depthBlock =
    complexity === "simple"
      ? [
          "--- RESPONSE DEPTH: SIMPLE ---",
          "Quick lookup — a few sentences or a short bullet list. Include exact Sales prices from catalog rows.",
        ]
      : complexity === "deep"
        ? [
            "--- RESPONSE DEPTH: DEEP ---",
            "Full structured answer: lead with the direct answer, then tables for comparisons, filters, margin math, or totals.",
          ]
        : [
            "--- RESPONSE DEPTH: STANDARD ---",
            "Complete but focused — enough detail to quote from, without filler.",
          ];

  return [
    "--- PRICE BOOK COPILOT ---",
    `Turn ${turnNumber}. Answer only from your organization's price book (prefetched results + search_price_book).`,
    "Never invent products, SKUs, specs, or prices. If nothing matches, say so and suggest refining the search.",
    "For margin/markup: use List and Sales from catalog rows — show the math in plain numbers (no LaTeX).",
    ...depthBlock,
  ].join("\n");
}

/** Drop prior assistant turns that listed catalog items without pricebook ids. */
export function filterCatalogHistory(history: ChatTurn[]): ChatTurn[] {
  return history.filter((m) => {
    if (m.role !== "assistant") return true;
    const c = m.content;
    const looksLikeCatalogList =
      /\b(price\s*book|catalog|do we sell|we carry|sku)\b/i.test(c) &&
      /\$\d|sales|list price/i.test(c);
    const hasPricebookIds = /\[pricebook:[a-f0-9-]+\]/i.test(c);
    if (looksLikeCatalogList && !hasPricebookIds) return false;
    return true;
  });
}
