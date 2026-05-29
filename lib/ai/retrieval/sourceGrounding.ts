import type { DocumentCitation } from "@/lib/ai/retrieveDocumentChunks";
import type { PriceBookSearchHit } from "@/lib/ai/searchPriceBook";
import type { MemorySearchHit } from "@/lib/ai/retrieval/hybridMemories";
import type { PriorProjectHit } from "@/lib/ai/retrieval/priorProjectRetrieval";

export type InternalSourceType =
  | "pricebook"
  | "project_document"
  | "prior_project"
  | "memory";

export interface InternalSourceCitation {
  type: InternalSourceType;
  label: string;
  id?: string;
  pageStart?: number;
  pageEnd?: number;
  fileName?: string;
}

export function pricebookSources(hits: PriceBookSearchHit[]): InternalSourceCitation[] {
  return hits.map((h) => ({
    type: "pricebook" as const,
    id: h.id,
    label: h.product_name,
  }));
}

export function documentSources(citations: DocumentCitation[]): InternalSourceCitation[] {
  return citations.map((c) => ({
    type: "project_document" as const,
    id: c.documentId,
    fileName: c.fileName,
    pageStart: c.pageStart,
    pageEnd: c.pageEnd,
    label: `${c.fileName} (p. ${c.pageStart}${c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ""})`,
  }));
}

export function memorySources(hits: MemorySearchHit[]): InternalSourceCitation[] {
  return hits.map((h) => ({
    type: "memory" as const,
    id: h.id,
    label: h.title?.trim() || `${h.scope} memory`,
  }));
}

export function priorProjectSources(hits: PriorProjectHit[]): InternalSourceCitation[] {
  return hits.map((h) => ({
    type: "prior_project" as const,
    id: h.projectId,
    label: h.projectName,
  }));
}

export function formatInternalSourcesForPrompt(sources: InternalSourceCitation[]): string {
  if (sources.length === 0) return "";
  const lines = sources.map((s) => {
    switch (s.type) {
      case "pricebook":
        return `- [pricebook:${s.id}] ${s.label}`;
      case "project_document":
        return `- [doc:${s.id}] ${s.label}`;
      case "prior_project":
        return `- [project:${s.id}] ${s.label}`;
      case "memory":
        return `- [memory:${s.id}] ${s.label}`;
      default:
        return `- ${s.label}`;
    }
  });
  return [
    "## Internal source references (cite inline when using this data)",
    ...lines,
    "",
    "When referencing internal data, include the bracket tag (e.g. [pricebook:uuid]) or page citation (File.pdf, p. 12).",
  ].join("\n");
}
