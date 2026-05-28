import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isPdfMime,
  MAX_DRIVE_INLINE_INDEX_BYTES,
} from "@/lib/ai/documentProcessingConfig";
import { enqueuePdfDocuments, getPdfProcessingStatus } from "@/lib/ai/enqueueDocumentProcessing";
import { extractFileContent } from "@/lib/ai/extractFileContent";
import { retrieveDocumentChunks } from "@/lib/ai/retrieveDocumentChunks";

const MAX_DOCS_PER_INDEX_RUN = 8;
const MAX_DOCS_IN_CATALOG = 80;
const MAX_NOTES_IN_CONTEXT = 15;
const MAX_CONTEXT_CHARS = 100_000;
const EXCERPT_DEFAULT = 4_000;
const EXCERPT_RELEVANT = 8_000;
const MAX_DETAILED_DOCS = 12;
const MAX_DRIVE_PDF_DOCS_FOR_RETRIEVAL = 5;

export interface ProjectDocumentIndexRow {
  id: string;
  project_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  mime_type?: string | null;
  processing_status?: string | null;
  extracted_text: string | null;
  vision_summary: string | null;
  search_text: string | null;
  parse_status: string;
  parse_error: string | null;
  indexed_at: string | null;
  created_at: string;
}

function buildSearchText(
  fileName: string,
  extractedText: string | null,
  visionSummary: string | null,
): string {
  const parts = [fileName];
  if (visionSummary) parts.push(visionSummary);
  if (extractedText) parts.push(extractedText);
  return parts.join("\n\n").slice(0, 150_000);
}

export function isAnalyzableDriveFile(mimeType: string, fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return true;
  if (mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(lower)) return true;
  if (mimeType.includes("csv") || lower.endsWith(".csv")) return true;
  if (mimeType.startsWith("text/") || lower.endsWith(".txt") || lower.endsWith(".md")) return true;
  return false;
}

function needsLegacyIndexing(row: ProjectDocumentIndexRow): boolean {
  const mime = row.mime_type ?? row.file_type;
  if (isPdfMime(mime, row.file_name)) return false;
  if (row.parse_status === "processing") return false;
  if (row.parse_status === "ready" || row.parse_status === "skipped") {
    return !(row.search_text || row.extracted_text || row.vision_summary);
  }
  return row.parse_status === "pending" || row.parse_status === "error";
}

async function indexOneNonPdfDocument(
  supabase: SupabaseClient,
  row: ProjectDocumentIndexRow,
): Promise<void> {
  const now = new Date().toISOString();

  if (row.file_size > MAX_DRIVE_INLINE_INDEX_BYTES) {
    await supabase
      .from("project_documents")
      .update({
        parse_status: "skipped",
        parse_error: "File exceeds 25MB indexing limit",
        indexed_at: now,
        updated_at: now,
      })
      .eq("id", row.id)
      .eq("project_id", row.project_id);
    return;
  }

  if (!isAnalyzableDriveFile(row.file_type, row.file_name)) {
    const searchText = buildSearchText(row.file_name, null, null);
    await supabase
      .from("project_documents")
      .update({
        parse_status: "skipped",
        parse_error: null,
        search_text: searchText,
        indexed_at: now,
        updated_at: now,
      })
      .eq("id", row.id)
      .eq("project_id", row.project_id);
    return;
  }

  await supabase
    .from("project_documents")
    .update({ parse_status: "processing", updated_at: now })
    .eq("id", row.id)
    .eq("project_id", row.project_id);

  const { data: blob, error: downloadError } = await supabase.storage
    .from("project-files")
    .download(row.storage_path);

  if (downloadError || !blob) {
    await supabase
      .from("project_documents")
      .update({
        parse_status: "error",
        parse_error: downloadError?.message ?? "Could not download file",
        updated_at: now,
      })
      .eq("id", row.id)
      .eq("project_id", row.project_id);
    return;
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  const mime = row.mime_type ?? row.file_type;
  const extracted = await extractFileContent(buffer, mime, row.file_name);
  const searchText = buildSearchText(
    row.file_name,
    extracted.extractedText,
    extracted.visionSummary,
  );

  await supabase
    .from("project_documents")
    .update({
      extracted_text: extracted.extractedText,
      vision_summary: extracted.visionSummary,
      search_text: searchText,
      parse_status: extracted.parseStatus === "ready" ? "ready" : "error",
      parse_error: extracted.parseError,
      indexed_at: now,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("project_id", row.project_id);
}

/**
 * Schedule background PDF processing and index non-PDF Drive files inline.
 * Does not block on full PDF chunking.
 */
export async function ensureProjectDriveIndexed(
  supabase: SupabaseClient,
  projectId: string,
  options?: { maxDocs?: number; documentIds?: string[] },
): Promise<{ indexed: number; pending: number; pdfEnqueued: number }> {
  const maxDocs = options?.maxDocs ?? MAX_DOCS_PER_INDEX_RUN;

  let query = supabase
    .from("project_documents")
    .select(
      "id, project_id, file_name, file_type, mime_type, file_size, storage_path, extracted_text, vision_summary, search_text, parse_status, parse_error, processing_status, indexed_at, created_at",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (options?.documentIds?.length) {
    query = query.in("id", options.documentIds);
  }

  const { data: rows } = await query;
  const docs = (rows ?? []) as ProjectDocumentIndexRow[];

  const pdfEnqueue = await enqueuePdfDocuments(supabase, projectId, {
    documentIds: options?.documentIds,
    maxDocs,
  });

  const toIndex = docs.filter(needsLegacyIndexing).slice(0, maxDocs);
  let indexed = 0;
  for (const doc of toIndex) {
    await indexOneNonPdfDocument(supabase, doc);
    indexed += 1;
  }

  const pdfStatus = await getPdfProcessingStatus(supabase, projectId);
  const pending =
    pdfStatus.pending +
    pdfStatus.processing +
    docs.filter((d) => needsLegacyIndexing(d)).length;

  return { indexed, pending: Math.max(0, pending - indexed), pdfEnqueued: pdfEnqueue.enqueued };
}

function scoreDocument(
  doc: ProjectDocumentIndexRow,
  queryTerms: string[],
): number {
  if (queryTerms.length === 0) return 0;
  const hay = (doc.search_text ?? doc.file_name).toLowerCase();
  return queryTerms.reduce((score, term) => (hay.includes(term) ? score + 1 : 0), 0);
}

function queryTerms(query?: string): string[] {
  if (!query?.trim()) return [];
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 2)
    .slice(0, 24);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function excerptForDoc(
  doc: ProjectDocumentIndexRow,
  maxChars: number,
): string {
  const parts: string[] = [];
  if (doc.vision_summary) parts.push(`Image/diagram summary:\n${doc.vision_summary}`);
  if (doc.extracted_text) parts.push(`Extracted text:\n${doc.extracted_text}`);
  const body = parts.join("\n\n") || "(No extractable text — metadata only.)";
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars)}\n\n[Excerpt truncated…]`;
}

function pdfStatusLabel(doc: ProjectDocumentIndexRow): string {
  const mime = doc.mime_type ?? doc.file_type;
  if (!isPdfMime(mime, doc.file_name)) {
    return doc.parse_status === "ready"
      ? "indexed"
      : doc.parse_status === "processing"
        ? "indexing…"
        : doc.parse_status === "skipped"
          ? "metadata only"
          : doc.parse_status === "error"
            ? `index error: ${doc.parse_error ?? "unknown"}`
            : "pending index";
  }
  switch (doc.processing_status) {
    case "ready":
      return "indexed (chunked)";
    case "processing":
      return "processing PDF…";
    case "failed":
      return `processing error: ${doc.parse_error ?? "unknown"}`;
    default:
      return "pending PDF processing";
  }
}

async function loadDrivePdfChunkContext(
  supabase: SupabaseClient,
  projectId: string,
  pdfDocs: ProjectDocumentIndexRow[],
  userMessage?: string,
): Promise<string> {
  const readyPdfs = pdfDocs.filter((d) => d.processing_status === "ready");
  if (readyPdfs.length === 0) return "";

  const terms = queryTerms(userMessage);
  const ranked = [...readyPdfs]
    .map((doc) => ({ doc, score: scoreDocument(doc, terms) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DRIVE_PDF_DOCS_FOR_RETRIEVAL);

  const docIds = ranked.map((r) => r.doc.id);
  const fileNames: Record<string, string> = {};
  for (const r of ranked) fileNames[r.doc.id] = r.doc.file_name;

  const retrieved = await retrieveDocumentChunks(
    supabase,
    projectId,
    docIds,
    userMessage ?? "",
    fileNames,
  );

  if (!retrieved.promptText) return "";
  return `### Drive PDF content (chunk retrieval)\n\n${retrieved.promptText}`;
}

async function loadProjectNotesBlock(
  supabase: SupabaseClient,
  projectId: string,
): Promise<string> {
  const { data: notes } = await supabase
    .from("project_notes")
    .select("id, title, plain_text, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(MAX_NOTES_IN_CONTEXT);

  if (!notes?.length) return "";

  const blocks = notes
    .filter((n) => (n.plain_text as string | null)?.trim())
    .map((n) => {
      const text = (n.plain_text as string).trim();
      const preview =
        text.length > 3_000 ? `${text.slice(0, 3_000)}\n[Note truncated…]` : text;
      return `### Note: ${n.title}\n${preview}`;
    });

  if (blocks.length === 0) return "";
  return `## Project notes (Drive)\n\n${blocks.join("\n\n---\n\n")}`;
}

/**
 * Build Drive + notes context for the active project only.
 */
export async function loadProjectDriveContext(
  supabase: SupabaseClient,
  projectId: string,
  userMessage?: string,
): Promise<string> {
  const { data: docs } = await supabase
    .from("project_documents")
    .select(
      "id, project_id, file_name, file_type, mime_type, file_size, storage_path, processing_status, extracted_text, vision_summary, search_text, parse_status, parse_error, indexed_at, created_at",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(MAX_DOCS_IN_CATALOG);

  const documents = (docs ?? []) as ProjectDocumentIndexRow[];
  const terms = queryTerms(userMessage);
  const pdfStatus = await getPdfProcessingStatus(supabase, projectId);

  const lines: string[] = [
    "## Project Drive (this project only)",
    `Project ID: ${projectId}`,
    "SECURITY: Only files uploaded to this project's Drive tab are listed below. Do not reference or infer content from other projects.",
    "",
  ];

  if (pdfStatus.pending + pdfStatus.processing > 0) {
    lines.push(
      `Note: ${pdfStatus.pending + pdfStatus.processing} PDF(s) still processing in background. Answers may improve when processing completes.`,
      "",
    );
  }

  if (documents.length === 0) {
    lines.push("(No files in Drive yet.)", "");
  } else {
    lines.push("### File catalog");
    for (const doc of documents) {
      const status = pdfStatusLabel(doc);
      const contentHint =
        doc.processing_status === "ready" || doc.extracted_text || doc.vision_summary
          ? " — has searchable content"
          : "";
      lines.push(
        `- ${doc.file_name} (${doc.file_type}, ${formatBytes(doc.file_size)}) — ${status}${contentHint}`,
      );
    }
    lines.push("");
  }

  const pdfDocs = documents.filter((d) =>
    isPdfMime(d.mime_type ?? d.file_type, d.file_name),
  );
  const nonPdfDocs = documents.filter(
    (d) => !isPdfMime(d.mime_type ?? d.file_type, d.file_name),
  );

  const pdfChunkBlock = await loadDrivePdfChunkContext(
    supabase,
    projectId,
    pdfDocs,
    userMessage,
  );
  if (pdfChunkBlock) {
    lines.push(pdfChunkBlock, "");
  }

  const ranked = [...nonPdfDocs]
    .map((doc) => ({ doc, score: scoreDocument(doc, terms) }))
    .sort((a, b) => b.score - a.score);

  const withContent = nonPdfDocs.filter(
    (d) => d.parse_status === "ready" && (d.extracted_text || d.vision_summary),
  );

  const detailed =
    terms.length > 0
      ? ranked.filter((r) => r.score > 0).map((r) => r.doc)
      : withContent;

  const selected = detailed.slice(0, MAX_DETAILED_DOCS);

  if (selected.length > 0) {
    const heading =
      terms.length > 0
        ? "### Relevant Drive file content (matched to the user's message)"
        : "### Drive file content (recent indexed files)";
    lines.push(heading, "");

    let usedChars = lines.join("\n").length;
    for (const doc of selected) {
      const maxChars =
        terms.length > 0 && scoreDocument(doc, terms) > 0
          ? EXCERPT_RELEVANT
          : EXCERPT_DEFAULT;
      const block = `#### ${doc.file_name}\n${excerptForDoc(doc, maxChars)}`;
      if (usedChars + block.length > MAX_CONTEXT_CHARS) {
        lines.push("[Additional Drive files omitted due to context size limit.]");
        break;
      }
      lines.push(block, "");
      usedChars += block.length;
    }
  }

  const notesBlock = await loadProjectNotesBlock(supabase, projectId);
  if (notesBlock) {
    if (lines.join("\n").length + notesBlock.length <= MAX_CONTEXT_CHARS) {
      lines.push(notesBlock, "");
    }
  }

  lines.push(
    "### Spreadsheets in Drive",
    "Editable estimate spreadsheets are summarized in the QUOTE CONTEXT section above (project_spreadsheets). Do not duplicate line-item pricing here.",
    "",
  );

  return lines.join("\n").trim();
}
