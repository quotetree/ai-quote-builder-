import { RFP_FILENAME_RE, RFP_MIN_PAGES_FOR_MODE } from "@/lib/ai/rfp/rfpRetrievalConfig";

export type RfpIntent =
  | "executive_summary"
  | "locations"
  | "quantities"
  | "equipment_inventory"
  | "materials"
  | "scope_of_work"
  | "quote_requirements"
  | "labor_requirements"
  | "maintenance_requirements"
  | "exclusions_assumptions"
  | "systems_platforms"
  | "certifications_compliance"
  | "risks_gaps"
  | "addendums_changes";

const INTENT_PATTERNS: Record<RfpIntent, RegExp[]> = {
  executive_summary: [
    /\b(summarize|summary|overview|executive|high[- ]?level|what is this|tell me about)\b/i,
    /\b(overall|big picture|key points)\b/i,
  ],
  locations: [
    /\b(location|locations|site|sites|facility|facilities|building|buildings|floor|room|campus|where)\b/i,
    /\b(address|premises|area|areas|wing)\b/i,
  ],
  quantities: [
    /\b(how many|quantity|quantities|count|number of|total|qty)\b/i,
    /\b(workload|inventory)\b/i,
  ],
  equipment_inventory: [
    /\b(equipment|device|devices|camera|cameras|panel|panels|reader|readers|sensor|sensors)\b/i,
    /\b(head end|controller|controllers|switch|switches|access point)\b/i,
  ],
  materials: [
    /\b(material|materials|bom|bill of materials|cable|cabling|wire|conduit|hardware)\b/i,
    /\b(equipment list|device schedule|panel schedule)\b/i,
  ],
  scope_of_work: [
    /\b(scope|scope of work|sow|work required|contractor shall|shall provide|deliverable)\b/i,
    /\b(install|replace|furnish|provide|perform)\b/i,
  ],
  quote_requirements: [
    /\b(quote|pricing|price|proposal|bid|submit|submission|deliverable|format)\b/i,
    /\b(clin|line item|base bid)\b/i,
  ],
  labor_requirements: [
    /\b(labor|man[- ]?hour|hours|fte|technician|installer|crew)\b/i,
    /\b(service hours|response time)\b/i,
  ],
  maintenance_requirements: [
    /\b(maintenance|service|repair|warranty|preventive|lifecycle)\b/i,
    /\b(ongoing|annual|monthly service)\b/i,
  ],
  exclusions_assumptions: [
    /\b(exclusion|exclude|assumption|not included|except|alternate|alternates)\b/i,
    /\b(base bid|optional)\b/i,
  ],
  systems_platforms: [
    /\b(system|systems|platform|integration|network|low voltage|security|fire alarm|av)\b/i,
    /\b(access control|structured cabling|telecom|electrical|mechanical|controls)\b/i,
  ],
  certifications_compliance: [
    /\b(certification|certified|license|compliance|testing|commissioning|inspection)\b/i,
    /\b(nfpa|nec|ul|factory witness)\b/i,
  ],
  risks_gaps: [
    /\b(risk|risks|gap|gaps|missing|unclear|ambigu|concern|issue)\b/i,
    /\b(what.*missing|need clarification)\b/i,
  ],
  addendums_changes: [
    /\b(addendum|addenda|amendment|revision|change|updated|modification)\b/i,
  ],
};

const BROAD_SUMMARY_RE =
  /\b(summarize|summary|overview|analyze|review this|what do i need|help me bid|estimate this)\b/i;

export interface RfpClassificationResult {
  intents: RfpIntent[];
  isRfpAnalysisMode: boolean;
}

export interface RfpModeContext {
  hasChunkedPdf: boolean;
  fileNames: string[];
  pageCounts: number[];
}

export function classifyRfpIntents(userMessage: string): RfpIntent[] {
  const msg = userMessage.trim();
  if (!msg) return ["executive_summary"];

  const matched = new Set<RfpIntent>();
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as [
    RfpIntent,
    RegExp[],
  ][]) {
    if (patterns.some((p) => p.test(msg))) matched.add(intent);
  }

  if (BROAD_SUMMARY_RE.test(msg)) {
    matched.add("executive_summary");
    matched.add("locations");
    matched.add("quantities");
    matched.add("scope_of_work");
    matched.add("quote_requirements");
    matched.add("labor_requirements");
    matched.add("exclusions_assumptions");
  }

  if (matched.size === 0) {
    matched.add("executive_summary");
    matched.add("scope_of_work");
  }

  return Array.from(matched);
}

export function resolveRfpAnalysisMode(
  userMessage: string,
  ctx: RfpModeContext,
): RfpClassificationResult {
  const intents = classifyRfpIntents(userMessage);

  const filenameMatch = ctx.fileNames.some((n) => RFP_FILENAME_RE.test(n));
  const largeDoc = ctx.pageCounts.some((p) => p >= RFP_MIN_PAGES_FOR_MODE);
  const multiIntent = intents.length >= 2;

  const isRfpAnalysisMode =
    ctx.hasChunkedPdf &&
    (filenameMatch || largeDoc || multiIntent || BROAD_SUMMARY_RE.test(userMessage));

  return { intents, isRfpAnalysisMode };
}
