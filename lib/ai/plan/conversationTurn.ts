import type { FullProjectContextResult } from "@/lib/ai/buildFullProjectContext";
import {
  isCatalogInventoryQuestion,
  isCatalogListFollowUp,
  isCatalogConversationThread,
} from "@/lib/ai/plan/catalogConversation";
import {
  isHybridPricebookSpecQuery,
  isProductResearchFromConversation,
  isProductSpecResearchQuery,
  userWantsPricebookSearch,
} from "@/lib/ai/plan/productResearchContext";
import type { ChatTurn } from "@/lib/ai/plan/webResearchContext";
import { isExternalWebResearchQuery } from "@/lib/ai/retrieval/retrievalRouter";

export type TaskComplexity = "simple" | "standard" | "deep";

export type TurnIntent =
  | "catalog_lookup"
  | "web_research"
  | "hybrid_catalog_web"
  | "product_research"
  | "document_analysis"
  | "general";

const SHORT_FOLLOW_UP =
  /^(?:ok(?:ay)?|yes|yeah|sure|please|go ahead|proceed|do it|continue|and|now|so|then)[,.]?\s*/i;

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
      content: `${m.content.slice(0, maxAssistantChars)}\n\n[Earlier reply truncated — key facts are in the latest messages and project context.]`,
    };
  });
}

function recentCorpus(history: ChatTurn[], userMessage: string, n = 6): string {
  return [...history.slice(-n).map((h) => h.content), userMessage].join("\n");
}

/** Short utterances that refer to the prior turn ("search for that", "compare to our pricebook"). */
export function isContextualFollowUp(userMessage: string): boolean {
  const msg = userMessage.trim();
  if (msg.length > 140) return false;
  return (
    SHORT_FOLLOW_UP.test(msg) ||
    /\b(that|those|this|these|it|them|same one|same option|the above|you (?:said|found|listed))\b/i.test(
      msg,
    )
  );
}

export function inferTurnIntent(
  userMessage: string,
  history: ChatTurn[],
): TurnIntent {
  const msg = userMessage.trim();
  const corpus = recentCorpus(history, msg);

  if (isCatalogInventoryQuestion(msg, history) || isCatalogListFollowUp(msg, history)) {
    return "catalog_lookup";
  }
  if (
    (/\bcompare\b/i.test(msg) && /\b(?:our|my)\s+price\s*book\b/i.test(msg)) ||
    (userWantsPricebookSearch(msg, history) && isProductSpecResearchQuery(msg)) ||
    isHybridPricebookSpecQuery(msg, history)
  ) {
    return "hybrid_catalog_web";
  }
  if (userWantsPricebookSearch(msg, history)) {
    return "catalog_lookup";
  }
  if (isCatalogConversationThread(history) && isContextualFollowUp(msg)) {
    return "catalog_lookup";
  }
  if (isProductResearchFromConversation(msg, history) || isProductSpecResearchQuery(msg)) {
    return "product_research";
  }
  if (isExternalWebResearchQuery(msg) || /\b(search online|distributors?|dealers?)\b/i.test(msg)) {
    return "web_research";
  }

  if (isContextualFollowUp(msg)) {
    if (/\bprice\s*book|catalog|we sell|our (?:parts|skus)\b/i.test(msg)) {
      return "catalog_lookup";
    }
    if (/\bcompare\b/i.test(msg) && /\bprice\s*book|catalog\b/i.test(corpus)) {
      return "hybrid_catalog_web";
    }
    if (
      /\b(search|find|look up)\b/i.test(msg) &&
      /\bprice\s*book|catalog|how much|sku\b/i.test(corpus) &&
      !/\bonline|web|distribut/i.test(msg)
    ) {
      return "catalog_lookup";
    }
    if (
      /\b(search|find|look up|what about)\b/i.test(msg) &&
      /\b(distribut|online|web search|manufacturer|datasheet)\b/i.test(corpus)
    ) {
      return "web_research";
    }
    if (isHybridPricebookSpecQuery(msg, history)) {
      return "hybrid_catalog_web";
    }
    if (isCatalogListFollowUp(msg, history)) {
      return "catalog_lookup";
    }
    if (
      /\b(camera|model|mp|megapixel|dome|fisheye)\b/i.test(corpus) &&
      !isCatalogConversationThread(history)
    ) {
      return "product_research";
    }
  }

  if (/\b(rfp|pws|schedule|drawing|attached|pdf|how many devices)\b/i.test(msg)) {
    return "document_analysis";
  }

  return "general";
}

export function assessTaskComplexity(
  userMessage: string,
  history: ChatTurn[],
  intent: TurnIntent,
): TaskComplexity {
  const msg = userMessage.trim();

  if (intent === "catalog_lookup") {
    if (
      isContextualFollowUp(msg) ||
      (/\bhow much\b/i.test(msg) && msg.length < 120) ||
      /\bdo we (?:carry|stock|sell)\b/i.test(msg)
    ) {
      return "simple";
    }
    return "standard";
  }

  if (intent === "web_research" && msg.length < 100 && !isExternalWebResearchQuery(msg)) {
    return "standard";
  }

  if (
    intent === "product_research" ||
    intent === "hybrid_catalog_web" ||
    intent === "document_analysis"
  ) {
    return "deep";
  }

  if (/\b(compare|research|analyze|every location|each room|rfp|breakdown)\b/i.test(msg)) {
    return "deep";
  }

  if (/\b(site\s*map|legend)\b/i.test(msg) && /\b(how many|count|total|readers?|cameras?)\b/i.test(msg)) {
    return "standard";
  }

  if (msg.length < 80 && !isContextualFollowUp(msg)) {
    return "simple";
  }

  return "standard";
}

export function conversationTurnInstructions(
  intent: TurnIntent,
  complexity: TaskComplexity,
  turnNumber: number,
): string {
  const depthBlock =
    complexity === "simple"
      ? [
          "--- RESPONSE DEPTH: SIMPLE ---",
          "This is a quick lookup or narrow follow-up. Answer in a few sentences or a short bullet list. No long tables unless the user asked for a comparison.",
        ]
      : complexity === "deep"
        ? [
            "--- RESPONSE DEPTH: DEEP ---",
            "This task needs full analysis: lead with the direct answer, then structured sections and tables where useful. Do not give a one-paragraph summary.",
          ]
        : [
            "--- RESPONSE DEPTH: STANDARD ---",
            "Give a complete but focused answer — enough detail to act on, without unnecessary padding.",
          ];

  const consistency = [
    "--- CONVERSATION QUALITY ---",
    `This is turn ${turnNumber} in the same chat. Match the thoroughness of your best first reply — do not shorten or go generic just because earlier messages exist.`,
    "The user's **latest message** defines the task. If they switched topic (price book → web → compare), follow the **new** task — do not stay stuck on the previous mode.",
    "Resolve \"that\", \"those\", \"it\", and \"the option\" from the immediately preceding user/assistant exchange.",
  ];

  const intentBlock =
    intent === "catalog_lookup"
      ? "Active task: **price book / catalog** — use search_price_book and prefetched catalog context. Quote only **Sales** prices from those results; never invent or use web MSRP."
      : intent === "web_research"
        ? "Active task: **web research** — use Tavily / web_search; do not default to price book unless the user asked for catalog."
        : intent === "hybrid_catalog_web"
          ? "Active task: **hybrid** — SKUs and **Sales** prices only from price book; specs/MP from web. Never mix web pricing into catalog prices."
          : intent === "product_research"
            ? "Active task: **product research** — tables and model-level detail; web for specs, price book only if they mentioned your catalog."
            : intent === "document_analysis"
              ? "Active task: **document / plan** — cite attachments and schedules with page refs."
              : "";

  return [...consistency, ...depthBlock, intentBlock].filter(Boolean).join("\n");
}

/** Shorter project context on later turns so the model does not skim or shorten answers. */
export function buildCompactProjectContext(ctx: FullProjectContextResult): string {
  const parts: string[] = [];
  const quote = ctx.quotePrompt?.trim();
  if (quote) {
    parts.push(
      quote.length > 2500 ? `${quote.slice(0, 2500)}\n\n[Quote context truncated]` : quote,
    );
  }
  if (ctx.attachmentPrompt?.trim()) {
    const att =
      ctx.attachmentPrompt.length > 6000
        ? `${ctx.attachmentPrompt.slice(0, 6000)}\n\n[Attachment context truncated]`
        : ctx.attachmentPrompt;
    parts.push(att);
  }
  if (ctx.retrievalPrompt?.trim()) {
    const ret =
      ctx.retrievalPrompt.length > 5000
        ? `${ctx.retrievalPrompt.slice(0, 5000)}\n\n[Retrieval truncated]`
        : ctx.retrievalPrompt;
    parts.push(ret);
  }
  const drive = ctx.drivePrompt?.trim();
  if (drive && drive.length < 4000) {
    parts.push(drive);
  } else {
    parts.push(
      "## Project Drive",
      "Files are indexed for this project. Use tools (search_price_book, web_search, inspect_plan_page) and the conversation thread for specifics — full Drive excerpts omitted this turn to keep responses sharp.",
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

export function shouldUseMinimalWebFollowUpContext(
  userMessage: string,
  history: ChatTurn[],
): boolean {
  if (!isContextualFollowUp(userMessage)) return false;
  const intent = inferTurnIntent(userMessage, history);
  return intent === "web_research" && /^\s*(yes|ok|proceed|go ahead)/i.test(userMessage.trim());
}

/** Drop prior assistant turns that invented catalog items without pricebook ids. */
export function filterCatalogHistory(history: ChatTurn[]): ChatTurn[] {
  return history.filter((m) => {
    if (m.role !== "assistant") return true;
    const c = m.content;
    const looksLikeCatalogList =
      /\b(price\s*book|catalog|do we sell|we carry|verkada|sku)\b/i.test(c) &&
      /\b(camera|reader|dome|bullet)\b/i.test(c);
    const hasPricebookIds = /\[pricebook:[a-f0-9-]+\]/i.test(c);
    if (looksLikeCatalogList && !hasPricebookIds) return false;
    return true;
  });
}
