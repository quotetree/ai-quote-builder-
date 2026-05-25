import type { SupabaseClient } from "@supabase/supabase-js";
import { buildQuoteContext } from "@/lib/ai/buildQuoteContext";
import {
  ensureProjectDriveIndexed,
  loadProjectDriveContext,
} from "@/lib/ai/projectDriveContext";
import { loadPlanAttachmentContext } from "@/lib/ai/planAttachmentContext";

export interface FullProjectContextOptions {
  activeSpreadsheetId?: string | null;
  userMessage?: string;
  attachmentIds?: string[];
  /** Index up to N pending Drive files before loading context (chat send). */
  indexMaxDocs?: number;
}

export interface FullProjectContextResult {
  quotePrompt: string;
  drivePrompt: string;
  attachmentPrompt: string;
  combinedPrompt: string;
  driveIndex: { indexed: number; pending: number };
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

  const driveIndex = await ensureProjectDriveIndexed(supabase, projectId, {
    maxDocs: options.indexMaxDocs ?? 6,
  });

  const drivePrompt = await loadProjectDriveContext(
    supabase,
    projectId,
    options.userMessage,
  );

  let attachmentPrompt = "";
  if (options.attachmentIds && options.attachmentIds.length > 0) {
    attachmentPrompt = await loadPlanAttachmentContext(
      supabase,
      projectId,
      options.attachmentIds,
    );
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
  };
}
