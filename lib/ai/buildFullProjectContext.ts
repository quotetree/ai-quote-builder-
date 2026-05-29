import type { SupabaseClient } from "@supabase/supabase-js";
import { buildQuoteContext } from "@/lib/ai/buildQuoteContext";
import {
  getPdfProcessingStatus,
} from "@/lib/ai/enqueueDocumentProcessing";
import { loadProjectDriveContext } from "@/lib/ai/projectDriveContext";
import {
  formatAttachmentOnlyDriveScope,
  resolveAttachmentDocumentScope,
} from "@/lib/ai/plan/attachmentDocumentScope";
import { loadPlanAttachmentContext } from "@/lib/ai/planAttachmentContext";
import { runCopilotRetrieval } from "@/lib/ai/retrieval/copilotRetrieval";
import { getReadyPdfDocumentsForProject } from "@/lib/ai/retrieval/projectPdfDocs";
import {
  isExternalWebResearchQuery,
  isPricebookPrimaryPhrase,
  routeCopilotRetrieval,
  shouldLoadPlanAttachmentContext,
  type CopilotRetrievalSource,
} from "@/lib/ai/retrieval/retrievalRouter";
import { inferTurnIntent, type TurnIntent } from "@/lib/ai/plan/conversationTurn";
import type { ChatTurn } from "@/lib/ai/plan/webResearchContext";
import type { InternalSourceCitation } from "@/lib/ai/retrieval/sourceGrounding";
import type { DocumentCitation } from "@/lib/ai/retrieveDocumentChunks";

export interface FullProjectContextOptions {
  activeSpreadsheetId?: string | null;
  userMessage?: string;
  attachmentIds?: string[];
  userId?: string;
  chatHistory?: ChatTurn[];
}

export interface FullProjectContextResult {
  quotePrompt: string;
  drivePrompt: string;
  attachmentPrompt: string;
  retrievalPrompt: string;
  combinedPrompt: string;
  driveIndex: { indexed: number; pending: number; pdfEnqueued?: number };
  documentCitations: DocumentCitation[];
  internalSources: InternalSourceCitation[];
  routedSources: CopilotRetrievalSource[];
  primarySource: CopilotRetrievalSource | null;
  isRfpAnalysisMode: boolean;
  /** When true, document answers must come only from current-message attachments */
  attachmentOnlyMode: boolean;
  attachmentFileNames: string[];
}

/**
 * Assemble quote, Drive, and optional chat-attachment context for a single project.
 */
export async function buildFullProjectContext(
  supabase: SupabaseClient,
  projectId: string,
  options: FullProjectContextOptions = {},
): Promise<FullProjectContextResult | null> {
  const quoteContext = await buildQuoteContext(
    supabase,
    projectId,
    options.activeSpreadsheetId ?? null,
  );
  if (!quoteContext) return null;

  const { data: projectRow } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();

  const organizationId = projectRow?.organization_id as string | undefined;
  const userMessage = options.userMessage?.trim() ?? "";
  const hasAttachments = Boolean(options.attachmentIds?.length);

  const willLoadAttachments =
    hasAttachments &&
    shouldLoadPlanAttachmentContext(userMessage, options.attachmentIds);

  const attachmentScope =
    hasAttachments && options.attachmentIds?.length
      ? await resolveAttachmentDocumentScope(
          supabase,
          projectId,
          options.attachmentIds,
        )
      : null;

  const attachmentOnlyMode = Boolean(willLoadAttachments);

  let routePlan = userMessage
    ? routeCopilotRetrieval(userMessage, {
        hasAttachments,
        attachmentCount: options.attachmentIds?.length ?? 0,
      })
    : null;

  const turnIntent: TurnIntent | null = userMessage
    ? inferTurnIntent(userMessage, options.chatHistory ?? [])
    : null;
  if (
    routePlan &&
    turnIntent &&
    (turnIntent === "catalog_lookup" || turnIntent === "hybrid_catalog_web") &&
    !routePlan.sources.includes("pricebook")
  ) {
    routePlan = {
      ...routePlan,
      sources: [...routePlan.sources, "pricebook"],
      reasons: [...routePlan.reasons, "follow-up catalog / compare-to-pricebook intent"],
      primarySource: routePlan.primarySource ?? "pricebook",
    };
  }

  const pdfStatus = await getPdfProcessingStatus(supabase, projectId);
  const driveIndex = {
    indexed: pdfStatus.ready,
    pending: pdfStatus.pending + pdfStatus.processing,
  };

  let retrievalPrompt = "";
  let internalSources: InternalSourceCitation[] = [];
  let routedSources: CopilotRetrievalSource[] = routePlan?.sources ?? [];
  let primarySource = routePlan?.primarySource ?? null;
  let documentCitations: DocumentCitation[] = [];

  const externalWebResearch = Boolean(userMessage && isExternalWebResearchQuery(userMessage));
  const ranCopilotRetrieval = Boolean(
    userMessage &&
      organizationId &&
      options.userId &&
      !externalWebResearch &&
      !attachmentOnlyMode,
  );

  if (ranCopilotRetrieval) {
    const readyPdfs = await getReadyPdfDocumentsForProject(supabase, projectId);
    const pdfDocumentIds = attachmentScope?.documentIds.length
      ? attachmentScope.documentIds
      : readyPdfs.documentIds;
    const fileNamesByDocId = attachmentScope?.documentIds.length
      ? attachmentScope.fileNamesByDocId
      : readyPdfs.fileNamesByDocId;

    const retrieval = await runCopilotRetrieval(supabase, {
      organizationId: organizationId!,
      userId: options.userId!,
      projectId,
      userMessage,
      pdfDocumentIds,
      fileNamesByDocId,
      routePlan: routePlan!,
      hasAttachments,
      attachmentCount: options.attachmentIds?.length,
    });
    retrievalPrompt = retrieval.additionalPrompt;
    internalSources = retrieval.internalSources;
    routedSources = retrieval.routedSources;
    primarySource = retrieval.primarySource;
    documentCitations.push(...retrieval.documentCitations);
  }

  const skipPdfChunkRetrieval =
    externalWebResearch ||
    attachmentOnlyMode ||
    (ranCopilotRetrieval && !routedSources.includes("project_files"));

  const drivePrompt = attachmentOnlyMode && attachmentScope
    ? formatAttachmentOnlyDriveScope(attachmentScope)
    : await loadProjectDriveContext(supabase, projectId, options.userMessage, {
        skipPdfChunkRetrieval,
      });

  let attachmentPrompt = "";
  let isRfpAnalysisMode = false;

  if (willLoadAttachments) {
    const attachmentContext = await loadPlanAttachmentContext(supabase, projectId, {
      attachmentIds: options.attachmentIds,
      userMessage: options.userMessage,
    });
    attachmentPrompt = attachmentContext.promptText;
    documentCitations.push(...attachmentContext.documentCitations);
    isRfpAnalysisMode = attachmentContext.isRfpAnalysisMode;
  } else if (
    hasAttachments &&
    primarySource === "pricebook" &&
    isPricebookPrimaryPhrase(userMessage)
  ) {
    attachmentPrompt = [
      "## Chat attachments",
      `The user attached ${options.attachmentIds!.length} file(s) to this message, but the question is catalog/pricebook-focused.`,
      "Use the prefetched price book results and search_price_book — do not analyze the attachment unless the user asks about the document.",
    ].join("\n");
  }

  const combinedParts = attachmentOnlyMode
    ? [attachmentPrompt, quoteContext.promptText, drivePrompt]
    : [
        quoteContext.promptText,
        drivePrompt,
        retrievalPrompt,
        attachmentPrompt,
      ];

  const combinedPrompt = combinedParts.filter(Boolean).join("\n");

  if (attachmentOnlyMode && attachmentScope?.fileNames.length) {
    const allowed = new Set(attachmentScope.fileNames);
    documentCitations = documentCitations.filter((c) => allowed.has(c.fileName));
  }

  return {
    quotePrompt: quoteContext.promptText,
    drivePrompt,
    attachmentPrompt,
    retrievalPrompt,
    combinedPrompt,
    driveIndex,
    documentCitations,
    internalSources,
    routedSources,
    primarySource,
    isRfpAnalysisMode,
    attachmentOnlyMode,
    attachmentFileNames: attachmentScope?.fileNames ?? [],
  };
}
