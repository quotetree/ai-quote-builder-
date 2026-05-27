import { processProjectDocument } from "@/lib/ai/processProjectDocument";
import { createClient } from "@/lib/supabase/server";

const MAX_CONTINUATIONS = 20;

/**
 * Run document processing, re-invoking until complete or max continuations.
 */
export async function triggerDocumentProcessing(
  documentId: string,
  projectId: string,
): Promise<void> {
  const supabase = await createClient();
  let continuations = 0;

  while (continuations < MAX_CONTINUATIONS) {
    const result = await processProjectDocument(supabase, documentId, projectId);

    if (result.status === "ready" || result.status === "failed") {
      console.log(
        `[document-process] done | doc=${documentId} | status=${result.status} | pages=${result.pageCount ?? "?"} | chunks=${result.chunksWritten ?? "?"}`,
      );
      return;
    }

    if (!result.needsContinuation) return;
    continuations += 1;
  }

  console.log(
    `[document-process] ⚠️ max continuations reached | doc=${documentId}`,
  );
}
