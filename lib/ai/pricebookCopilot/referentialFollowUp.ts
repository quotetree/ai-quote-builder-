import type { ChatTurn } from "@/lib/ai/plan/webResearchContext";

const PRICEBOOK_ID_RE = /\[pricebook:([a-f0-9-]{36})\]/gi;

/** User is referring to a prior catalog result set, not starting a new search. */
const REFERENTIAL_PHRASES = [
  /\b(?:all of )?(?:these|those|them)\b/i,
  /\b(?:these|those|the)\s+(?:different\s+)?(?:products?|items?|skus?|cameras?|lines?|options?|ones?|results?|entries?|rows?)\b/i,
  /\b(?:that|the)\s+list\b/i,
  /\b(?:the ones?|items?)\s+(?:above|from above|you (?:just )?(?:found|listed|showed))\b/i,
  /\b(?:each|every) of (?:these|those|them)\b/i,
  /\b(?:for|on|about) (?:these|those|them|the ones above)\b/i,
  /\btheir\s+(?:margin|markup|profit|price|pricing|cost)\b/i,
  /\b(?:what(?:'s| is| are)|show|calculate|compute)\s+(?:the\s+)?(?:profit|margin|markup)\s+(?:on|for|of)\s+(?:all of )?(?:these|those|them)\b/i,
];

export interface ReferentialFollowUp {
  isReferential: true;
  productIds: string[];
  /** User question that produced the prior catalog list */
  priorUserQuery: string | null;
  /** Snippet label for prompts */
  priorResultLabel: string;
}

export function extractPricebookIdsFromText(text: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  PRICEBOOK_ID_RE.lastIndex = 0;
  while ((match = PRICEBOOK_ID_RE.exec(text)) !== null) {
    const id = match[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function isReferentialProductFollowUp(userMessage: string): boolean {
  const msg = userMessage.trim();
  if (!msg || msg.length > 280) return false;
  return REFERENTIAL_PHRASES.some((p) => p.test(msg));
}

export function getLastAssistantMessage(history: ChatTurn[]): ChatTurn | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === "assistant") return history[i]!;
  }
  return null;
}

/** User turn immediately before the most recent assistant message */
export function getPriorUserQueryBeforeLastAssistant(history: ChatTurn[]): string | null {
  let seenAssistant = false;
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]!;
    if (!seenAssistant) {
      if (turn.role === "assistant") seenAssistant = true;
      continue;
    }
    if (turn.role === "user") return turn.content.trim();
  }
  return null;
}

export function inferPriorResultLabel(
  priorUserQuery: string | null,
  assistantContent: string,
): string {
  if (priorUserQuery?.trim()) {
    return priorUserQuery.trim().slice(0, 120);
  }
  const firstLine = assistantContent.split("\n").find((l) => l.trim().length > 0);
  return firstLine?.trim().slice(0, 120) ?? "prior catalog results";
}

/**
 * When the user says "these products / that list / the ones above", bind to the
 * `[pricebook:uuid]` rows from the immediately previous assistant answer.
 */
export function resolveReferentialFollowUp(
  userMessage: string,
  history: ChatTurn[],
): ReferentialFollowUp | null {
  if (!isReferentialProductFollowUp(userMessage)) return null;

  const lastAssistant = getLastAssistantMessage(history);
  if (!lastAssistant) return null;

  const productIds = extractPricebookIdsFromText(lastAssistant.content);
  if (productIds.length === 0) return null;

  const priorUserQuery = getPriorUserQueryBeforeLastAssistant(history);

  return {
    isReferential: true,
    productIds,
    priorUserQuery,
    priorResultLabel: inferPriorResultLabel(priorUserQuery, lastAssistant.content),
  };
}

export function referentialFollowUpInstructions(followUp: ReferentialFollowUp): string {
  return [
    "--- REFERENTIAL FOLLOW-UP (mandatory) ---",
    `The user is asking about **${followUp.productIds.length} product(s)** from your **immediately previous answer** — NOT a new catalog search.`,
    `Prior question: "${followUp.priorResultLabel}"`,
    "Phrases like \"these products\", \"those items\", \"that list\", \"all of these\" refer ONLY to the pinned PRICE BOOK RESULT SET below.",
    "**Do NOT** call search_price_book for a broader query (e.g. all Rhombus items). **Do NOT** add products that are not in the pinned set.",
    "Answer only for the pinned rows — margins, prices, totals, comparisons, etc.",
  ].join("\n");
}
