import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStructuredExtractions } from "@/lib/ai/loadStructuredExtractions";
import { loadProjectSheetIndexSummary } from "@/lib/ai/plan/loadSheetIndexContext";
import {
  retrieveDocumentChunks,
  type DocumentCitation,
} from "@/lib/ai/retrieveDocumentChunks";
import { hybridSearchPriceBook } from "@/lib/ai/retrieval/hybridPriceBook";
import { searchMemories } from "@/lib/ai/retrieval/hybridMemories";
import { searchPriorProjects } from "@/lib/ai/retrieval/priorProjectRetrieval";
import {
  routeCopilotRetrieval,
  type CopilotRetrievalSource,
  type RetrievalRoutePlan,
} from "@/lib/ai/retrieval/retrievalRouter";
import {
  documentSources,
  formatInternalSourcesForPrompt,
  memorySources,
  priorProjectSources,
  pricebookSources,
  type InternalSourceCitation,
} from "@/lib/ai/retrieval/sourceGrounding";
import {
  CATALOG_LIST_ALL_CAP,
  enrichCatalogFiltersFromTerms,
  isCatalogBrowseQuery,
  parseCatalogQueryFilters,
} from "@/lib/ai/retrieval/catalogQueryFilters";
import { normalizeCatalogQuery } from "@/lib/ai/retrieval/catalogQueryNormalize";
import {
  formatPriceBookResultsForPrompt,
  mergeCatalogFilters,
  type PriceBookSearchParams,
} from "@/lib/ai/searchPriceBook";

const MAX_PREFETCH_PRICE_BOOK = 12;
const MAX_STRUCTURED_ITEMS = 20;
const MAX_CHUNKS_PRICEBOOK_PRIMARY = 6;
const MAX_CHUNKS_DEFAULT = 12;

export interface CopilotRetrievalInput {
  organizationId: string;
  userId: string;
  projectId: string;
  userMessage: string;
  pdfDocumentIds?: string[];
  fileNamesByDocId?: Record<string, string>;
  routePlan?: RetrievalRoutePlan;
  hasAttachments?: boolean;
  attachmentCount?: number;
}

export interface CopilotRetrievalResult {
  additionalPrompt: string;
  internalSources: InternalSourceCitation[];
  routedSources: CopilotRetrievalSource[];
  routeReasons: string[];
  primarySource: RetrievalRoutePlan["primarySource"];
  documentCitations: DocumentCitation[];
}

async function prefetchPriceBook(
  supabase: SupabaseClient,
  organizationId: string,
  query: string,
): Promise<{ prompt: string; sources: InternalSourceCitation[] }> {
  const normalized = normalizeCatalogQuery(query);
  const filters = enrichCatalogFiltersFromTerms(
    parseCatalogQueryFilters(query),
    normalized.terms,
  );
  const browse = isCatalogBrowseQuery(filters, normalized.terms.length);
  const { params } = mergeCatalogFilters(
    {
      query,
      max_results: browse ? CATALOG_LIST_ALL_CAP : MAX_PREFETCH_PRICE_BOOK,
    },
    query,
    normalized.terms,
  );
  const hybrid = await hybridSearchPriceBook(
    supabase,
    organizationId,
    params,
    filters,
  );
  const search = {
    query,
    total_scanned: hybrid.total_scanned,
    match_count: hybrid.results.length,
    total_matches: hybrid.total_matches,
    truncated: hybrid.truncated,
    results: hybrid.results,
  };
  return {
    prompt: formatPriceBookResultsForPrompt(search),
    sources: pricebookSources(hybrid.results),
  };
}

async function prefetchProjectFiles(
  supabase: SupabaseClient,
  input: CopilotRetrievalInput,
  plan: RetrievalRoutePlan,
): Promise<{ prompt: string; citations: DocumentCitation[]; sources: InternalSourceCitation[] }> {
  const docIds = input.pdfDocumentIds ?? [];
  const fileNames = input.fileNamesByDocId ?? {};
  const blocks: string[] = [];
  const citations: DocumentCitation[] = [];

  if (plan.preferSheetIndex) {
    const sheetBlock = await loadProjectSheetIndexSummary(supabase, input.projectId);
    if (sheetBlock) blocks.push(sheetBlock);
  }

  if (plan.preferStructuredExtractions && docIds.length > 0) {
    const structured = await loadStructuredExtractions(
      supabase,
      input.projectId,
      docIds,
      fileNames,
      { maxItems: MAX_STRUCTURED_ITEMS },
    );
    if (structured) {
      blocks.push(`## Structured project extractions (schedules, specs, quantities)\n\n${structured}`);
    }
  }

  if (docIds.length > 0 && input.userMessage.trim()) {
    const maxChunks =
      plan.primarySource === "pricebook" ? MAX_CHUNKS_PRICEBOOK_PRIMARY : MAX_CHUNKS_DEFAULT;
    const retrieved = await retrieveDocumentChunks(
      supabase,
      input.projectId,
      docIds,
      input.userMessage,
      fileNames,
      { maxChunks },
    );
    if (retrieved.promptText) {
      blocks.push(`## Project file excerpts\n\n${retrieved.promptText}`);
      citations.push(...retrieved.citations);
    }
  }

  return {
    prompt: blocks.join("\n\n"),
    citations,
    sources: documentSources(citations),
  };
}

async function prefetchMemories(
  supabase: SupabaseClient,
  input: CopilotRetrievalInput,
): Promise<{ prompt: string; sources: InternalSourceCitation[] }> {
  const hits = await searchMemories(supabase, {
    organizationId: input.organizationId,
    userId: input.userId,
    projectId: input.projectId,
    query: input.userMessage,
  });

  if (hits.length === 0) return { prompt: "", sources: [] };

  const lines = hits.map((h) => {
    const title = h.title?.trim() ? `**${h.title}**` : `(${h.scope})`;
    const preview =
      h.content.length > 600 ? `${h.content.slice(0, 600)}…` : h.content;
    return `- ${title} [memory:${h.id}]\n  ${preview}`;
  });

  return {
    prompt: `## Relevant memories\n\n${lines.join("\n\n")}`,
    sources: memorySources(hits),
  };
}

async function prefetchPriorProjects(
  supabase: SupabaseClient,
  input: CopilotRetrievalInput,
): Promise<{ prompt: string; sources: InternalSourceCitation[] }> {
  const hits = await searchPriorProjects(supabase, {
    organizationId: input.organizationId,
    excludeProjectId: input.projectId,
    query: input.userMessage,
  });

  if (hits.length === 0) return { prompt: "", sources: [] };

  const lines = hits.map((h) => {
    const meta = h.metadata;
    const total =
      meta.last_quote_total != null ? ` | last quote total: ${meta.last_quote_total}` : "";
    return `### ${h.projectName} [project:${h.projectId}]${total}\n${h.profileText}`;
  });

  return {
    prompt: `## Similar prior projects (organization)\n\n${lines.join("\n\n---\n\n")}`,
    sources: priorProjectSources(hits),
  };
}

export interface PricebookCopilotRetrievalInput {
  organizationId: string;
  userMessage: string;
}

/** Price Book Copilot — always searches the org catalog, nothing else. */
export async function runPricebookCopilotRetrieval(
  supabase: SupabaseClient,
  input: PricebookCopilotRetrievalInput,
): Promise<CopilotRetrievalResult> {
  const pricebookBlocks: string[] = [];
  const internalSources: InternalSourceCitation[] = [];

  const result = await prefetchPriceBook(
    supabase,
    input.organizationId,
    input.userMessage,
  );
  if (result.prompt) {
    pricebookBlocks.push(`## Price book (prefetched)\n\n${result.prompt}`);
  }
  internalSources.push(...result.sources);

  const grounding = formatInternalSourcesForPrompt(internalSources);
  const additionalPrompt = [grounding, ...pricebookBlocks].filter(Boolean).join("\n\n");

  return {
    additionalPrompt,
    internalSources,
    routedSources: ["pricebook"],
    routeReasons: ["pricebook copilot — catalog only"],
    primarySource: "pricebook",
    documentCitations: [],
  };
}

export async function runCopilotRetrieval(
  supabase: SupabaseClient,
  input: CopilotRetrievalInput,
): Promise<CopilotRetrievalResult> {
  const plan =
    input.routePlan ??
    routeCopilotRetrieval(input.userMessage, {
      hasAttachments: input.hasAttachments,
      attachmentCount: input.attachmentCount,
    });

  const pricebookBlocks: string[] = [];
  const projectBlocks: string[] = [];
  const otherBlocks: string[] = [];
  const internalSources: InternalSourceCitation[] = [];
  const documentCitations: DocumentCitation[] = [];

  const tasks: Promise<void>[] = [];

  if (plan.sources.includes("pricebook")) {
    tasks.push(
      prefetchPriceBook(supabase, input.organizationId, input.userMessage).then((r) => {
        if (r.prompt) pricebookBlocks.push(`## Price book (prefetched)\n\n${r.prompt}`);
        internalSources.push(...r.sources);
      }),
    );
  }

  if (plan.sources.includes("project_files")) {
    tasks.push(
      prefetchProjectFiles(supabase, input, plan).then((r) => {
        if (r.prompt) projectBlocks.push(r.prompt);
        documentCitations.push(...r.citations);
        internalSources.push(...r.sources);
      }),
    );
  }

  if (plan.sources.includes("memories")) {
    tasks.push(
      prefetchMemories(supabase, input).then((r) => {
        if (r.prompt) otherBlocks.push(r.prompt);
        internalSources.push(...r.sources);
      }),
    );
  }

  if (plan.sources.includes("prior_quotes")) {
    tasks.push(
      prefetchPriorProjects(supabase, input).then((r) => {
        if (r.prompt) otherBlocks.push(r.prompt);
        internalSources.push(...r.sources);
      }),
    );
  }

  await Promise.all(tasks);

  const orderedBlocks =
    plan.primarySource === "pricebook"
      ? [...pricebookBlocks, ...otherBlocks, ...projectBlocks]
      : [...projectBlocks, ...pricebookBlocks, ...otherBlocks];

  const grounding = formatInternalSourcesForPrompt(internalSources);
  const additionalPrompt = [grounding, ...orderedBlocks].filter(Boolean).join("\n\n");

  return {
    additionalPrompt,
    internalSources,
    routedSources: plan.sources,
    routeReasons: plan.reasons,
    primarySource: plan.primarySource,
    documentCitations,
  };
}
