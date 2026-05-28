import type { SupabaseClient } from "@supabase/supabase-js";
import { buildQuoteContext } from "@/lib/ai/buildQuoteContext";
import {
  getPdfProcessingStatus,
} from "@/lib/ai/enqueueDocumentProcessing";
import { loadProjectDriveContext } from "@/lib/ai/projectDriveContext";
import { loadPlanAttachmentContext } from "@/lib/ai/planAttachmentContext";
import type { DocumentCitation } from "@/lib/ai/retrieveDocumentChunks";

export interface FullProjectContextOptions {
  activeSpreadsheetId?: string | null;
  userMessage?: string;
  attachmentIds?: string[];
}

export interface FullProjectContextResult {
  quotePrompt: string;
  drivePrompt: string;
  attachmentPrompt: string;
  combinedPrompt: string;
  driveIndex: { indexed: number; pending: number; pdfEnqueued?: number };
  documentCitations: DocumentCitation[];
  isRfpAnalysisMode: boolean;
}

/**
 * Assemble quote, Drive, and optional chat-attachment context for a single project.
 * PDF processing runs in background — never blocks on Drive indexing.
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

  const pdfStatus = await getPdfProcessingStatus(supabase, projectId);
  const driveIndex = {
    indexed: pdfStatus.ready,
    pending: pdfStatus.pending + pdfStatus.processing,
  };

  const drivePrompt = await loadProjectDriveContext(
    supabase,
    projectId,
    options.userMessage,
  );

  let attachmentPrompt = "";
  let documentCitations: DocumentCitation[] = [];
  let isRfpAnalysisMode = false;
  if (options.attachmentIds && options.attachmentIds.length > 0) {
    const attachmentContext = await loadPlanAttachmentContext(supabase, projectId, {
      attachmentIds: options.attachmentIds,
      userMessage: options.userMessage,
    });
    attachmentPrompt = attachmentContext.promptText;
    documentCitations = attachmentContext.documentCitations;
    isRfpAnalysisMode = attachmentContext.isRfpAnalysisMode;
  }

  const combinedPrompt = [
    quoteContext.promptText,
    drivePrompt ? `\n${drivePrompt}` : "",
    attachmentPrompt ? `\n${attachmentPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    quotePrompt: quoteContext.promptText,
    drivePrompt,
    attachmentPrompt,
    combinedPrompt,
    driveIndex,
    documentCitations,
    isRfpAnalysisMode,
  };
}
