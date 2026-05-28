import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { rasterizePdfPage } from "@/lib/ai/ocr/rasterizePdfPage";
import { planPageRenderScale } from "@/lib/ai/plan/planPageConfig";

export interface InspectPlanPageArgs {
  documentId?: string;
  pageNumber?: number;
  sheetNumber?: string;
  focus?: string;
}

export interface InspectPlanPageResult {
  success: boolean;
  documentId: string;
  fileName: string;
  pageNumber: number;
  sheetNumber: string | null;
  summary: string;
  error?: string;
}

async function resolvePage(
  supabase: SupabaseClient,
  projectId: string,
  args: InspectPlanPageArgs,
): Promise<{
  documentId: string;
  pageNumber: number;
  fileName: string;
  sheetNumber: string | null;
} | null> {
  if (args.documentId && args.pageNumber) {
    const { data: doc } = await supabase
      .from("project_documents")
      .select("id, file_name")
      .eq("id", args.documentId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!doc) return null;
    return {
      documentId: doc.id,
      pageNumber: args.pageNumber,
      fileName: doc.file_name,
      sheetNumber: null,
    };
  }

  if (args.sheetNumber?.trim()) {
    const sheet = args.sheetNumber.trim().toUpperCase();
    const { data: row } = await supabase
      .from("document_sheet_index")
      .select("document_id, page_number, sheet_number")
      .eq("project_id", projectId)
      .ilike("sheet_number", sheet)
      .limit(1)
      .maybeSingle();

    if (!row) return null;

    const { data: doc } = await supabase
      .from("project_documents")
      .select("file_name")
      .eq("id", row.document_id)
      .maybeSingle();

    return {
      documentId: row.document_id,
      pageNumber: row.page_number,
      fileName: doc?.file_name ?? "Document",
      sheetNumber: row.sheet_number,
    };
  }

  return null;
}

async function loadPageImageBuffer(
  supabase: SupabaseClient,
  documentId: string,
  pageNumber: number,
  storagePath: string | null,
  pdfStoragePath: string,
): Promise<Buffer> {
  if (storagePath) {
    const { data, error } = await supabase.storage.from("project-files").download(storagePath);
    if (!error && data) return Buffer.from(await data.arrayBuffer());
  }

  const { data: pdfBlob, error: pdfError } = await supabase.storage
    .from("project-files")
    .download(pdfStoragePath);
  if (pdfError || !pdfBlob) {
    throw new Error(pdfError?.message ?? "Could not download PDF");
  }
  const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());
  return rasterizePdfPage(pdfBuffer, pageNumber, planPageRenderScale());
}

/**
 * Vision inspection of a plan sheet (on-demand Copilot tool).
 */
export async function inspectPlanPage(
  supabase: SupabaseClient,
  projectId: string,
  args: InspectPlanPageArgs,
): Promise<InspectPlanPageResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      documentId: args.documentId ?? "",
      fileName: "",
      pageNumber: args.pageNumber ?? 0,
      sheetNumber: null,
      summary: "",
      error: "OpenAI API key not configured",
    };
  }

  const resolved = await resolvePage(supabase, projectId, args);
  if (!resolved) {
    return {
      success: false,
      documentId: args.documentId ?? "",
      fileName: "",
      pageNumber: args.pageNumber ?? 0,
      sheetNumber: args.sheetNumber ?? null,
      summary: "",
      error: "Could not resolve document/page from sheet number or documentId+pageNumber",
    };
  }

  const { data: doc } = await supabase
    .from("project_documents")
    .select("storage_path")
    .eq("id", resolved.documentId)
    .eq("project_id", projectId)
    .single();

  const { data: pageRow } = await supabase
    .from("document_pages")
    .select("storage_path, sheet_number, sheet_title, discipline, trade, native_text, ocr_text")
    .eq("document_id", resolved.documentId)
    .eq("page_number", resolved.pageNumber)
    .maybeSingle();

  if (!doc?.storage_path) {
    return {
      success: false,
      documentId: resolved.documentId,
      fileName: resolved.fileName,
      pageNumber: resolved.pageNumber,
      sheetNumber: resolved.sheetNumber,
      summary: "",
      error: "Document storage path missing",
    };
  }

  try {
    const imageBuffer = await loadPageImageBuffer(
      supabase,
      resolved.documentId,
      resolved.pageNumber,
      pageRow?.storage_path ?? null,
      doc.storage_path,
    );
    const base64 = imageBuffer.toString("base64");
    const mime = pageRow?.storage_path?.endsWith(".webp") ? "image/webp" : "image/png";

    const meta = [
      pageRow?.sheet_number ? `Sheet: ${pageRow.sheet_number}` : null,
      pageRow?.sheet_title ? `Title: ${pageRow.sheet_title}` : null,
      pageRow?.discipline ? `Discipline: ${pageRow.discipline}` : null,
      pageRow?.trade ? `Trade: ${pageRow.trade}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const textContext = [pageRow?.native_text, pageRow?.ocr_text].filter(Boolean).join("\n").slice(0, 2000);

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      max_tokens: 1500,
      messages: [
        {
          role: "system",
          content:
            "You are an estimator reviewing a construction plan sheet. Describe symbols, legends, devices, notes, quantities visible on the sheet. Be specific and practical for bidding. If uncertain, say so.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `File: ${resolved.fileName}`,
                `Page: ${resolved.pageNumber}`,
                meta,
                args.focus ? `Focus: ${args.focus}` : "",
                textContext ? `Extracted text on page:\n${textContext}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${base64}` },
            },
          ],
        },
      ],
    });

    const summary = completion.choices[0]?.message?.content?.trim() ?? "No analysis returned.";

    return {
      success: true,
      documentId: resolved.documentId,
      fileName: resolved.fileName,
      pageNumber: resolved.pageNumber,
      sheetNumber: pageRow?.sheet_number ?? resolved.sheetNumber,
      summary,
    };
  } catch (err) {
    return {
      success: false,
      documentId: resolved.documentId,
      fileName: resolved.fileName,
      pageNumber: resolved.pageNumber,
      sheetNumber: resolved.sheetNumber,
      summary: "",
      error: err instanceof Error ? err.message : "Vision inspection failed",
    };
  }
}

export function formatInspectPlanPageForTool(result: InspectPlanPageResult): string {
  if (!result.success) {
    return `Plan page inspection failed: ${result.error ?? "unknown error"}`;
  }
  const sheet = result.sheetNumber ? ` (${result.sheetNumber})` : "";
  return [
    `## Plan sheet inspection: ${result.fileName}${sheet} — page ${result.pageNumber}`,
    result.summary,
    "",
    "Use this visual analysis together with indexed text/chunks. Cite the sheet/page in your answer.",
  ].join("\n");
}
