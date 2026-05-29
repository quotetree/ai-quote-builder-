import {
  isPlanLayoutCameraQuery,
  isSiteMapDeviceInventoryQuery,
} from "@/lib/ai/plan/planLayoutAnalysis";

export type CopilotRetrievalSource =
  | "pricebook"
  | "project_files"
  | "prior_quotes"
  | "memories";

export type CopilotRetrievalPrimarySource = CopilotRetrievalSource | null;

export interface RouteCopilotRetrievalOptions {
  hasAttachments?: boolean;
  attachmentCount?: number;
}

export interface RetrievalRoutePlan {
  sources: CopilotRetrievalSource[];
  reasons: string[];
  primarySource: CopilotRetrievalPrimarySource;
  loadAttachmentContext: boolean;
  preferStructuredExtractions: boolean;
  preferSheetIndex: boolean;
}

/** Strong catalog signals — pricebook is primary even with attachments / open project */
const PRICEBOOK_PRIMARY_PATTERNS = [
  /\bwe\s+sell\b/i,
  /\bour\s+price\s*book\b/i,
  /\bour\s+pricebook\b/i,
  /\b(?:the\s+)?price\s*book\b/i,
  /\bin\s+our\s+pricebook\b/i,
  /\bour\s+(?:parts?|products?|equipment|skus?)\b/i,
  /\b(?:the\s+)?parts?\s+(?:we|in\s+our)\b/i,
  /\bskus?\b/i,
  /\blabor\s*lines?\b/i,
  /\bhow\s+much\b/i,
  /\bwhat\s+.+\s+do we\s+(?:carry|stock|sell|offer)\b/i,
  /\b(?:do we|we)\s+(?:carry|stock|sell|offer)\b/i,
];

/** Vendor/market research — answer via web search, not internal price book */
const EXTERNAL_WEB_RESEARCH_PATTERNS = [
  /\b(distributors?|dealers?|wholesalers?|suppliers?|vendors?|resellers?)\b/i,
  /\b(find|get|give|show)\s+(?:me\s+)?(?:a\s+)?list\b/i,
  /\b(local|nearby|near\s+me|close\s+to|in\s+or\s+(?:near|local\s+to|\w+\s+to)|local\s+to)\b/i,
  /\b(where\s+(?:can|do)\s+(?:i|we)\s+(?:buy|find|get|source))\b/i,
  /\b(authorized\s+dealer|distributor\s+locator|where\s+to\s+buy)\b/i,
  /\bwho\s+(?:carry|carries|sell|sells|stock|stocks|distribute|distributes)\b/i,
  /\b(market\s+research|industry\s+director(?:y|ies))\b/i,
  /\b(inland\s+empire|socal|southern\s+california)\b/i,
];

const PRODUCT_INTENT_PATTERNS = [
  /\b(catalog|manufacturer|model|part\s*number|product\s*line)\b/i,
  /\b(camera|reader|panel|switch|bridge|cable|conduit|gateway|cellular|telecom|modem|antenna|verkada)\b/i,
  /\b(access\s*control|poe|cat6|wireless|dome|ptz|card\s*reader|intercom|multisensor|multi\s*sensor)\b/i,
  /\b(labor\s*line|install(?:ing)?\s+a|compatible\s*accessor)\b/i,
  /\b(outdoor|item|line\s*item|component|sensor)\b/i,
  /\bwhat\s+(?:do\s+)?we\s+(?:carry|stock|offer)\b/i,
];

const DOCUMENT_INTENT_PATTERNS = [
  /\b(drawing|plan|sheet|spec|schedule|rfp|pws|addendum|submittal)\b/i,
  /\b(device\s*schedule|panel\s*schedule|spec\s*section|scope\s*item)\b/i,
  /\b(?:page|pdf|document|excerpt)\b/i,
  /\b[A-Z]{1,3}[-.]?\d{2,4}\b/,
];

const PROJECT_SCOPE_PATTERNS = [
  /\bthis\s+(?:project|job|bid|rfp|document|file|pdf|attachment)\b/i,
  /\b(?:the\s+)?attached\b/i,
  /\b(?:on|in)\s+this\s+bid\b/i,
  /\b(?:in|from)\s+(?:the\s+)?drive\b/i,
  /\buploaded\s+(?:file|pdf|document)\b/i,
  /\bthis\s+sow\b/i,
];

const PRIOR_QUOTE_PATTERNS = [
  /\b(similar|past|previous|prior|another|other)\s+(project|quote|job|bid)\b/i,
  /\b(like\s+we\s+did|we\s+did\s+before|historical|benchmark)\b/i,
  /\b(comparable\s+project|reference\s+project)\b/i,
];

const MEMORY_PATTERNS = [
  /\b(remember|preference|always\s+use|we\s+usually|our\s+standard)\b/i,
  /\b(company\s+policy|org\s+default|standard\s+markup|typical\s+approach)\b/i,
  /\b(project\s+note|client\s+prefers|customer\s+wants)\b/i,
];

function scorePatterns(text: string, patterns: RegExp[]): number {
  return patterns.reduce((n, p) => (p.test(text) ? n + 1 : 0), 0);
}

/** Spec questions on bid/plan PDFs (manufacturer, counts) — not org price book */
const ATTACHMENT_SPEC_PATTERNS = [
  /\b(?:what|which)\s+(?:camera|manufacturer|brand|make)\b/i,
  /\bhow\s+many\s+(?:camera|device|equipment)/i,
  /\b(?:they|owner|client|architect|bid|project)\b.*\b(?:asking|require|specify|spec|want|need)\b/i,
  /\b(?:asking|required|specified|called\s+for)\b.*\b(?:camera|device|equipment|manufacturer)\b/i,
  /\b(?:camera|device)\s+(?:manufacturer|brand|make|count|quantity|quantities)\b/i,
];

export function isAttachmentSpecQuestion(text: string): boolean {
  const msg = text.trim();
  if (!msg) return false;
  if (isPricebookPrimaryPhrase(msg)) return false;
  if (ATTACHMENT_SPEC_PATTERNS.some((p) => p.test(msg))) return true;
  if (isPlanLayoutCameraQuery(msg)) return true;
  if (isSiteMapDeviceInventoryQuery(msg)) return true;
  return false;
}

function normalizeRetrievalQueryTypos(msg: string): string {
  return msg
    .replace(/\blcoal\b/gi, "local")
    .replace(/\bditributors?\b/gi, "distributors");
}

export function isExternalWebResearchQuery(text: string): boolean {
  const msg = normalizeRetrievalQueryTypos(text.trim());
  if (!msg) return false;

  if (/\bwhat\s+(?:do\s+)?we\s+(?:carry|stock|sell|offer)\b/i.test(msg)) return false;
  if (/\b(?:our|my)\s+price\s*book\b/i.test(msg)) return false;
  if (/\bhow\s+much\b/i.test(msg) && /\b(?:our|price\s*book|pricebook)\b/i.test(msg)) {
    return false;
  }

  return EXTERNAL_WEB_RESEARCH_PATTERNS.some((p) => p.test(msg));
}

export function buildWebSearchQuery(userMessage: string): string {
  let msg = normalizeRetrievalQueryTypos(userMessage.trim());

  const isDistributorQuery = /\b(distributors?|dealers?|wholesalers?|suppliers?)\b/i.test(msg);

  if (isDistributorQuery) {
    if (!/\b(security|low[\s-]?voltage|cctv|access\s*control|alarm|integrator|av)\b/i.test(msg)) {
      msg = `${msg} security low voltage equipment distributor`;
    }
    if (/\bOntario\b/i.test(msg) && /\bCA\b/.test(msg) && !/\bCalifornia\b/i.test(msg)) {
      msg = msg.replace(/\bCA\b/, "California");
    }
    if (/\b(local|near|nearby|in\s+or\s+near)\b/i.test(msg) && !/\bdistributor\b/i.test(msg)) {
      msg = `${msg} distributor`;
    }
  }

  return msg;
}

export function isPricebookPrimaryPhrase(text: string): boolean {
  if (isExternalWebResearchQuery(text)) return false;
  return PRICEBOOK_PRIMARY_PATTERNS.some((p) => p.test(text));
}

export function routePricebookCopilotRetrieval(userMessage: string): RetrievalRoutePlan {
  const msg = userMessage.trim();
  return {
    sources: ["pricebook"],
    reasons: msg
      ? ["pricebook copilot — catalog-only mode"]
      : ["pricebook copilot — empty query"],
    primarySource: "pricebook",
    loadAttachmentContext: false,
    preferStructuredExtractions: false,
    preferSheetIndex: false,
  };
}

/**
 * Fast heuristic router — no LLM call.
 */
export function routeCopilotRetrieval(
  userMessage: string,
  options: RouteCopilotRetrievalOptions = {},
): RetrievalRoutePlan {
  const msg = userMessage.trim();
  const reasons: string[] = [];
  const hasAttachments = Boolean(options.hasAttachments && (options.attachmentCount ?? 0) > 0);

  if (!msg) {
    return {
      sources: ["project_files"],
      reasons: ["empty query — light project catalog only"],
      primarySource: "project_files",
      loadAttachmentContext: hasAttachments,
      preferStructuredExtractions: false,
      preferSheetIndex: false,
    };
  }

  if (isExternalWebResearchQuery(msg)) {
    return {
      sources: [],
      reasons: ["external vendor/market research — use web search, not price book"],
      primarySource: null,
      loadAttachmentContext: false,
      preferStructuredExtractions: false,
      preferSheetIndex: false,
    };
  }

  const pricebookPrimary = isPricebookPrimaryPhrase(msg);
  const planLayout = hasAttachments && isPlanLayoutCameraQuery(msg);
  const attachmentSpec = hasAttachments && (isAttachmentSpecQuestion(msg) || planLayout);
  const productIntent = scorePatterns(msg, PRODUCT_INTENT_PATTERNS);
  const documentIntent = scorePatterns(msg, DOCUMENT_INTENT_PATTERNS);
  const projectScope = scorePatterns(msg, PROJECT_SCOPE_PATTERNS);
  const priorQuotes = scorePatterns(msg, PRIOR_QUOTE_PATTERNS) > 0;
  const memories = scorePatterns(msg, MEMORY_PATTERNS) > 0;

  const isDocumentQuestion =
    attachmentSpec ||
    documentIntent > 0 ||
    projectScope > 0 ||
    (hasAttachments &&
      /\b(camera|manufacturer|device|equipment|how\s+many|schedule|quantity)\b/i.test(msg)) ||
    /\b(rfp|pws|spec|schedule|sheet|drawing|addendum|submittal|quantit(y|ies)|device\s*schedule)\b/i.test(
      msg,
    );
  const isCatalogQuestion =
    pricebookPrimary ||
    /\bwhat\s+.+\s+do we\s+(?:carry|stock|sell|offer)\b/i.test(msg) ||
    (/\b(?:do we|we)\s+(?:carry|stock|sell|offer)\b/i.test(msg) &&
      scorePatterns(msg, PRODUCT_INTENT_PATTERNS) > 0);

  const sources: CopilotRetrievalSource[] = [];

  if (priorQuotes) {
    sources.push("prior_quotes");
    reasons.push("prior project/quote similarity");
  }

  if (memories) {
    sources.push("memories");
    reasons.push("memory/preference keywords");
  }

  if (isDocumentQuestion && !pricebookPrimary) {
    sources.push("project_files");
    reasons.push("document or project-scoped intent");
  }

  if (isCatalogQuestion && !attachmentSpec) {
    sources.push("pricebook");
    reasons.push(
      pricebookPrimary
        ? "catalog-primary phrase (we sell / pricebook / parts / SKUs / how much / …)"
        : isDocumentQuestion
          ? "secondary — catalog terms with document context"
          : "product/catalog intent",
    );
  }

  if (!sources.includes("project_files") && (hasAttachments || isDocumentQuestion)) {
    sources.push("project_files");
    reasons.push(
      hasAttachments ? "default — attached documents" : "default — project file context",
    );
  }

  let primarySource: CopilotRetrievalPrimarySource = null;
  if (hasAttachments && !pricebookPrimary) {
    primarySource = "project_files";
    if (!sources.includes("project_files")) {
      sources.unshift("project_files");
      reasons.push("attached files — analyze documents first");
    }
    if (attachmentSpec) {
      const pricebookIdx = sources.indexOf("pricebook");
      if (pricebookIdx >= 0) {
        sources.splice(pricebookIdx, 1);
        reasons.push("bid spec on attachment — skip pricebook");
      }
    }
  } else if (pricebookPrimary && sources.includes("pricebook")) {
    primarySource = "pricebook";
  } else if (isDocumentQuestion && sources.includes("project_files")) {
    primarySource = "project_files";
  } else if (sources.includes("pricebook")) {
    primarySource = "pricebook";
  } else if (sources[0]) {
    primarySource = sources[0];
  }

  const loadAttachmentContext = hasAttachments && !pricebookPrimary;

  if (hasAttachments && !loadAttachmentContext && pricebookPrimary) {
    reasons.push("attachments present but catalog-primary — skip attachment RFP");
  }

  const preferSheetIndex =
    sources.includes("project_files") &&
    /\b(sheet|drawing|plan|legend|symbol|camera|schedule)\b/i.test(msg);
  const preferStructuredExtractions =
    sources.includes("project_files") &&
    /\b(schedule|quantity|quantities|spec|scope|bom|inventory|device|camera|manufacturer)\b/i.test(
      msg,
    );

  return {
    sources,
    reasons,
    primarySource,
    loadAttachmentContext,
    preferStructuredExtractions,
    preferSheetIndex,
  };
}

export function shouldLoadPlanAttachmentContext(
  userMessage: string,
  attachmentIds?: string[],
): boolean {
  if (!attachmentIds?.length) return false;
  if (isPlanLayoutCameraQuery(userMessage) || isSiteMapDeviceInventoryQuery(userMessage)) {
    return true;
  }
  const plan = routeCopilotRetrieval(userMessage, {
    hasAttachments: true,
    attachmentCount: attachmentIds.length,
  });
  return plan.loadAttachmentContext;
}
