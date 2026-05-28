import OpenAI from "openai";
import type { DocumentChunkMetadata } from "@/types/database";
import type { ExtractionDraft, SchedulePayload } from "@/lib/ai/extraction/types";
import {
  detectQuantitiesInText,
  detectSpecSectionsInText,
  EXTRACTION_VERSION,
} from "@/lib/ai/extraction/types";

function isScheduleCandidate(meta: DocumentChunkMetadata | null | undefined, text: string): boolean {
  if (meta?.has_table) return true;
  return /\b(panel schedule|device schedule|equipment schedule|door schedule|schedule of)\b/i.test(
    text,
  );
}

async function extractScheduleWithLlm(
  openai: OpenAI,
  chunkText: string,
  pageStart: number,
  pageEnd: number,
): Promise<ExtractionDraft | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extract schedule/table data from construction or RFP document text. Return JSON: { schedule_kind, columns, rows, title, confidence }. rows is array of objects keyed by column name. If not a schedule, return { schedule_kind: \"unknown\", columns: [], rows: [], title: null, confidence: 0 }.",
        },
        {
          role: "user",
          content: chunkText.slice(0, 6000),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SchedulePayload & {
      title?: string;
      confidence?: number;
    };
    if (!parsed.rows?.length) return null;

    return {
      extraction_type: "schedule",
      page_start: pageStart,
      page_end: pageEnd,
      title: parsed.title ?? `Schedule (p. ${pageStart})`,
      discipline: null,
      payload: {
        schedule_kind: parsed.schedule_kind ?? "unknown",
        columns: parsed.columns ?? [],
        rows: parsed.rows,
      },
      confidence: parsed.confidence ?? 0.7,
      source_chunk_ids: [],
    };
  } catch {
    return null;
  }
}

export interface ChunkForExtraction {
  id: string;
  page_start: number;
  page_end: number;
  chunk_text: string;
  chunk_metadata: DocumentChunkMetadata | null;
}

/**
 * Extract structured artifacts from processed chunks (heuristic + LLM for schedules).
 */
export async function extractStructuredArtifacts(
  chunks: ChunkForExtraction[],
  options?: { maxLlmCalls?: number },
): Promise<ExtractionDraft[]> {
  const maxLlm = options?.maxLlmCalls ?? 8;
  const drafts: ExtractionDraft[] = [];
  let llmCalls = 0;

  const openaiKey = process.env.OPENAI_API_KEY;
  const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

  for (const chunk of chunks) {
    const meta = chunk.chunk_metadata;

    for (const spec of detectSpecSectionsInText(chunk.chunk_text)) {
      drafts.push({
        extraction_type: "spec_section",
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        title: spec.title,
        discipline: spec.division ?? null,
        payload: spec,
        confidence: 0.85,
        source_chunk_ids: [chunk.id],
      });
    }

    for (const qty of detectQuantitiesInText(chunk.chunk_text, chunk.page_start)) {
      drafts.push({
        extraction_type: "quantity",
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        title: qty.item.slice(0, 80),
        discipline: null,
        payload: qty,
        confidence: qty.qty != null ? 0.75 : 0.5,
        source_chunk_ids: [chunk.id],
      });
    }

    if (meta?.has_table && !isScheduleCandidate(meta, chunk.chunk_text)) {
      drafts.push({
        extraction_type: "table",
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        title: `Table (p. ${chunk.page_start})`,
        discipline: null,
        payload: { excerpt: chunk.chunk_text.slice(0, 2000) },
        confidence: 0.6,
        source_chunk_ids: [chunk.id],
      });
    }

    if (isScheduleCandidate(meta, chunk.chunk_text) && openai && llmCalls < maxLlm) {
      llmCalls += 1;
      const schedule = await extractScheduleWithLlm(
        openai,
        chunk.chunk_text,
        chunk.page_start,
        chunk.page_end,
      );
      if (schedule) {
        schedule.source_chunk_ids = [chunk.id];
        drafts.push(schedule);
      }
    }
  }

  return dedupeExtractions(drafts);
}

function dedupeExtractions(drafts: ExtractionDraft[]): ExtractionDraft[] {
  const seen = new Set<string>();
  const out: ExtractionDraft[] = [];
  for (const d of drafts) {
    const key = `${d.extraction_type}:${d.page_start}:${d.title ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...d, payload: { ...d.payload, extraction_version: EXTRACTION_VERSION } });
  }
  return out.slice(0, 100);
}
