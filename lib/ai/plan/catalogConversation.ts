import type { ChatTurn } from "@/lib/ai/plan/webResearchContext";
import {
  isCatalogOnlyPricebookQuery,
  userWantsPricebookSearch,
} from "@/lib/ai/plan/productResearchContext";
import { isPricebookPrimaryPhrase } from "@/lib/ai/retrieval/retrievalRouter";

const DO_WE_CATALOG_RE =
  /\b(?:do we|we)\s+(?:\w+\s+){0,8}?(?:sell|carry|stock|offer)\b/i;

const CATALOG_THREAD_RE =
  /\b(price\s*book|pricebook|catalog|what we sell|our (?:parts|products|skus|cameras?))\b/i;

const CATALOG_LIST_FOLLOW_UP_RE =
  /\b(list(?:\s+it|\s+them|\s+those)?|show me|write (?:it )?out|give me the list|enumerate|spell it out|list out)\b/i;

const CATALOG_INVENTORY_QUESTION_RE =
  /\b(?:which|what)\s+.+\s+(?:do we|we)\s+(?:\w+\s+){0,4}?(?:sell|carry|stock|offer)\b/i;

/** User is asking what SKUs/items the org carries — not MP/spec research. */
export function isCatalogInventoryQuestion(
  userMessage: string,
  history: ChatTurn[] = [],
): boolean {
  const msg = userMessage.trim();
  if (!msg) return false;

  if (/\bcompare\b/i.test(msg) && /\bprice\s*book\b/i.test(msg)) return false;
  if (/\bresearch\b/i.test(msg) && /\bprice\s*book\b/i.test(msg)) return false;

  if (isPricebookPrimaryPhrase(msg)) return true;
  if (userWantsPricebookSearch(msg, history)) return true;
  if (isCatalogOnlyPricebookQuery(msg, history)) return true;
  if (CATALOG_INVENTORY_QUESTION_RE.test(msg)) return true;
  if (/\b(?:do we|we)\s+(?:\w+\s+){0,4}?(?:sell|carry|stock|offer)\b/i.test(msg)) {
    return true;
  }

  return false;
}

export function isCatalogConversationThread(history: ChatTurn[]): boolean {
  const recent = history.slice(-6).map((m) => m.content).join("\n");
  if (CATALOG_THREAD_RE.test(recent) || DO_WE_CATALOG_RE.test(recent)) {
    return true;
  }
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  if (lastUser) {
    const prior = history.filter((m) => m !== lastUser);
    return isCatalogInventoryQuestion(lastUser.content, prior);
  }
  return false;
}

export function isCatalogListFollowUp(
  userMessage: string,
  history: ChatTurn[],
): boolean {
  const msg = userMessage.trim();
  if (!CATALOG_LIST_FOLLOW_UP_RE.test(msg)) return false;
  if (isCatalogInventoryQuestion(msg, history)) return true;
  if (isCatalogConversationThread(history)) return true;
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  if (lastUser && isCatalogInventoryQuestion(lastUser.content, history)) {
    return true;
  }
  return false;
}

/** Reconstruct search text for mandatory catalog scan on short follow-ups. */
export function buildCatalogSearchQuery(
  userMessage: string,
  history: ChatTurn[],
): string {
  const msg = userMessage.trim();

  // Referential follow-ups must not trigger a new catalog scan
  if (
    /\b(?:these|those|them|the ones above|that list|all of these)\b/i.test(msg) &&
    /\b(?:margin|markup|profit|price|pricing|cost|total)\b/i.test(msg)
  ) {
    return msg;
  }

  if (msg.length > 40 && !CATALOG_LIST_FOLLOW_UP_RE.test(msg)) {
    return msg;
  }

  const userTurns = history.filter((m) => m.role === "user").slice(-3);
  const combined = [...userTurns.map((m) => m.content), msg].join(" ");
  if (combined.trim().length > 10) return combined.trim();
  return msg || "catalog";
}
