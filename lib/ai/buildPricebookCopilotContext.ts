import type { SupabaseClient } from "@supabase/supabase-js";
import { runPricebookCopilotRetrieval } from "@/lib/ai/retrieval/copilotRetrieval";
import type { InternalSourceCitation } from "@/lib/ai/retrieval/sourceGrounding";

export interface PricebookCopilotContextOptions {
  userMessage?: string;
  /** Skip broad prefetch when answering about a pinned prior result set */
  skipRetrieval?: boolean;
}

export interface PricebookCopilotContextResult {
  retrievalPrompt: string;
  combinedPrompt: string;
  internalSources: InternalSourceCitation[];
}

/**
 * Assemble price-book-only context for the Copilot chat rail.
 */
export async function buildPricebookCopilotContext(
  supabase: SupabaseClient,
  projectId: string,
  options: PricebookCopilotContextOptions = {},
): Promise<PricebookCopilotContextResult | null> {
  const { data: projectRow } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();

  const organizationId = projectRow?.organization_id as string | undefined;
  if (!organizationId) return null;

  const userMessage = options.userMessage?.trim() ?? "";

  let retrievalPrompt = "";
  let internalSources: InternalSourceCitation[] = [];

  if (userMessage && !options.skipRetrieval) {
    const retrieval = await runPricebookCopilotRetrieval(supabase, {
      organizationId,
      userMessage,
    });
    retrievalPrompt = retrieval.additionalPrompt;
    internalSources = retrieval.internalSources;
  }

  const intro = [
    "## Price Book Copilot",
    "You answer questions about this organization's internal price book only.",
    "Every product name, SKU, and price must come from prefetched search results or search_price_book tool output.",
  ].join("\n");

  const combinedPrompt = [intro, retrievalPrompt].filter(Boolean).join("\n\n");

  return {
    retrievalPrompt,
    combinedPrompt,
    internalSources,
  };
}
