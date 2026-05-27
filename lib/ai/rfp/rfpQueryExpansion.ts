import type { RfpIntent } from "@/lib/ai/rfp/rfpIntentClassifier";

export type RetrievalProfileKey =
  | "locations"
  | "schedules"
  | "scope"
  | "quote"
  | "labor"
  | "exclusions";

const GENERIC_EXPANSION = [
  "location",
  "locations",
  "site",
  "sites",
  "facility",
  "facilities",
  "building",
  "buildings",
  "floor",
  "room",
  "area",
  "campus",
  "schedule",
  "inventory",
  "quantity",
  "quantities",
  "workload",
  "bom",
  "bill of materials",
  "material list",
  "equipment list",
  "panel schedule",
  "riser",
  "one-line",
  "drawing",
  "spec",
  "specification",
  "scope",
  "deliverables",
  "alternates",
  "addendum",
  "labor",
  "service",
  "maintenance",
  "replacement",
  "install",
  "repair",
  "contractor shall",
  "pws",
  "clin",
  "compliance",
  "testing",
  "commissioning",
  "warranty",
  "certifications",
];

const PROFILE_TERMS: Record<RetrievalProfileKey, string[]> = {
  locations: [
    "location",
    "site",
    "facility",
    "building",
    "floor",
    "room",
    "campus",
    "address",
    "premises",
    "wing",
    "area",
    "installation site",
  ],
  schedules: [
    "schedule",
    "inventory",
    "quantity",
    "qty",
    "bom",
    "material list",
    "equipment list",
    "panel schedule",
    "device schedule",
    "riser",
    "table",
    "clin",
    "line item",
    "count",
    "total",
  ],
  scope: [
    "scope",
    "shall",
    "contractor shall",
    "provide",
    "install",
    "replace",
    "specification",
    "deliverable",
    "pws",
    "performance work statement",
    "requirement",
    "responsibility",
  ],
  quote: [
    "quote",
    "price",
    "pricing",
    "proposal",
    "bid",
    "submit",
    "deliverable",
    "clin",
    "base bid",
    "alternate",
    "format",
    "submission",
  ],
  labor: [
    "labor",
    "service",
    "maintenance",
    "warranty",
    "repair",
    "fte",
    "hour",
    "man hour",
    "response",
    "preventive",
    "ongoing",
  ],
  exclusions: [
    "exclude",
    "exclusion",
    "alternate",
    "addendum",
    "assumption",
    "not included",
    "except",
    "optional",
    "clarification",
    "deviation",
  ],
};

const INTENT_PROFILE_MAP: Partial<Record<RfpIntent, RetrievalProfileKey[]>> = {
  locations: ["locations"],
  quantities: ["schedules"],
  equipment_inventory: ["schedules", "scope"],
  materials: ["schedules", "scope"],
  scope_of_work: ["scope"],
  quote_requirements: ["quote"],
  labor_requirements: ["labor"],
  maintenance_requirements: ["labor"],
  exclusions_assumptions: ["exclusions"],
  certifications_compliance: ["scope", "exclusions"],
  addendums_changes: ["exclusions"],
  systems_platforms: ["scope", "schedules"],
  executive_summary: [
    "locations",
    "schedules",
    "scope",
    "quote",
    "labor",
    "exclusions",
  ],
  risks_gaps: ["scope", "schedules", "exclusions"],
};

function tokenize(message: string): string[] {
  return message
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 2);
}

function uniqueTerms(terms: string[]): string[] {
  return [...new Set(terms.map((t) => t.toLowerCase()))];
}

export function buildRetrievalProfiles(
  userMessage: string,
  intents: RfpIntent[],
): Record<RetrievalProfileKey, string[]> {
  const userTerms = tokenize(userMessage);
  const profiles = {} as Record<RetrievalProfileKey, string[]>;

  for (const key of Object.keys(PROFILE_TERMS) as RetrievalProfileKey[]) {
    const intentBoost: string[] = [];
    for (const intent of intents) {
      const mapped = INTENT_PROFILE_MAP[intent];
      if (mapped?.includes(key)) {
        intentBoost.push(...(PROFILE_TERMS[key] ?? []));
      }
    }

    profiles[key] = uniqueTerms([
      ...userTerms,
      ...PROFILE_TERMS[key],
      ...intentBoost,
      ...GENERIC_EXPANSION.slice(0, 12),
    ]);
  }

  return profiles;
}

export const RETRIEVAL_PROFILE_ORDER: RetrievalProfileKey[] = [
  "locations",
  "schedules",
  "scope",
  "quote",
  "labor",
  "exclusions",
];

export const RETRIEVAL_SECTION_TITLES: Record<RetrievalProfileKey, string> = {
  locations: "## RFP Retrieval — Locations & Facilities",
  schedules: "## RFP Retrieval — Schedules, Quantities & Material Lists",
  scope: "## RFP Retrieval — Scope & Specifications",
  quote: "## RFP Retrieval — Quote Requirements & Deliverables",
  labor: "## RFP Retrieval — Labor, Service & Maintenance",
  exclusions: "## RFP Retrieval — Exclusions, Alternates & Addendums",
};
