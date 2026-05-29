import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { rasterizePdfPage } from "@/lib/ai/ocr/rasterizePdfPage";
import { planPageRenderScale } from "@/lib/ai/plan/planPageConfig";
import { isSiteMapDeviceInventoryQuery } from "@/lib/ai/plan/planLayoutAnalysis";
import { cropLegendRegions } from "@/lib/ai/plan/cropLegendStrip";
import type { FloorPlanVisionJson } from "@/lib/ai/plan/floorPlanVision";
import {
  buildFloorPlanCountPrompt,
  FLOOR_PLAN_LEGEND_JSON_PROMPT,
  FLOOR_PLAN_VISION_JSON_PROMPT,
  deviceTypeFromSymbol,
  parseQtyFromLegendLabel,
  reconcileInventoryCounts,
  SITE_MAP_INVENTORY_JSON_PROMPT,
  SITE_MAP_LEGEND_QTY_PROMPT,
  floorPlanVisionImageUrl,
  formatFloorPlanVisionForPrompt,
  parseFloorPlanVisionJson,
  reconcileFloorPlanTotals,
} from "@/lib/ai/plan/floorPlanVision";
import { inspectPlanPage } from "@/lib/ai/plan/inspectPlanPage";

async function runVisionJson(
  openai: OpenAI,
  fileName: string,
  base64: string,
  mimeType: string,
  textPrompt: string,
): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.05,
    max_tokens: 4000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an expert low-voltage/security estimator. Count CCTV symbols using the legend only. Output valid JSON.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `File: ${fileName}\n\n${textPrompt}` },
          {
            type: "image_url",
            image_url: floorPlanVisionImageUrl(base64, mimeType),
          },
        ],
      },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() ?? "";
}

async function analyzeSiteMapInventory(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "";

  const openai = new OpenAI({ apiKey });

  let legendStripParsed: FloorPlanVisionJson | null = null;
  try {
    const crops = await cropLegendRegions(buffer);
    const mergedSummary: NonNullable<FloorPlanVisionJson["legend_summary"]> = [];

    for (let i = 0; i < crops.length; i++) {
      const stripB64 = crops[i]!.toString("base64");
      const legendRaw = await runVisionJson(
        openai,
        `${fileName} (legend region ${i + 1})`,
        stripB64,
        "image/png",
        SITE_MAP_LEGEND_QTY_PROMPT,
      );
      const stripJson = parseFloorPlanVisionJson(legendRaw);
      const rows =
        stripJson?.legend_summary ??
        stripJson?.legend?.map((l) => ({
          symbol_code: l.symbol_code,
          qty: parseQtyFromLegendLabel(l.legend_label ?? "") ?? undefined,
          legend_label: l.legend_label,
        })) ??
        [];
      for (const row of rows) {
        const code = (row.symbol_code ?? "").trim().toUpperCase();
        if (!code) continue;
        const existing = mergedSummary.find((r) => (r.symbol_code ?? "").toUpperCase() === code);
        const qty = typeof row.qty === "number" ? row.qty : parseQtyFromLegendLabel(row.legend_label ?? "");
        if (!existing) {
          mergedSummary.push({ ...row, symbol_code: code });
        } else if (qty != null && (existing.qty == null || qty > (existing.qty ?? 0))) {
          existing.qty = qty;
          existing.legend_label = row.legend_label ?? existing.legend_label;
        }
      }
    }

    if (mergedSummary.length > 0) {
      legendStripParsed = { legend_summary: mergedSummary };
    }
  } catch (err) {
    console.warn("[floor-plan-vision] legend region crops failed", err);
  }

  const base64 = buffer.toString("base64");
  const legendHint = legendStripParsed?.legend_summary?.length
    ? `\n\nLegend rows already read from legend crops (verify against map icons):\n${JSON.stringify(legendStripParsed.legend_summary, null, 2)}`
    : "";

  const raw = await runVisionJson(
    openai,
    fileName,
    base64,
    mimeType,
    SITE_MAP_INVENTORY_JSON_PROMPT + legendHint,
  );
  let parsed = parseFloorPlanVisionJson(raw);
  parsed = parsed ? reconcileInventoryCounts(parsed, legendStripParsed) : null;
  if (parsed?.symbol_counts) {
    for (const row of parsed.symbol_counts) {
      const label = parsed.legend?.find(
        (l) =>
          (l.symbol_code ?? "").toUpperCase() === (row.symbol_code ?? "").toUpperCase(),
      )?.legend_label;
      row.device_type =
        row.device_type ?? deviceTypeFromSymbol(row.symbol_code ?? "", label);
    }
  }

  if (parsed?.symbol_counts?.length) {
    const rdr = parsed.symbol_counts.find((s) => s.symbol_code === "RDR");
    console.log(
      `[floor-plan-vision] ${fileName} inventory | FCAM=${parsed.symbol_counts.find((s) => s.symbol_code === "FCAM")?.qty ?? 0} RDR=${rdr?.qty ?? 0} RACK=${parsed.symbol_counts.find((s) => s.symbol_code === "RACK")?.qty ?? 0}`,
    );
  }

  return formatFloorPlanVisionForPrompt(fileName, raw, parsed);
}

/**
 * Two-pass vision: extract legend first, then count markers with legend locked in context.
 */
async function analyzeLayoutImageBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<{ formatted: string; totals: Record<string, number> | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { formatted: "", totals: null };

  const openai = new OpenAI({ apiKey });
  const base64 = buffer.toString("base64");

  const legendRaw = await runVisionJson(
    openai,
    fileName,
    base64,
    mimeType,
    FLOOR_PLAN_LEGEND_JSON_PROMPT,
  );
  const legendParsed = parseFloorPlanVisionJson(legendRaw);

  let countRaw: string;
  if (legendParsed?.legend?.length) {
    countRaw = await runVisionJson(
      openai,
      fileName,
      base64,
      mimeType,
      buildFloorPlanCountPrompt(JSON.stringify({ legend: legendParsed.legend }, null, 2)),
    );
  } else {
    countRaw = await runVisionJson(
      openai,
      fileName,
      base64,
      mimeType,
      FLOOR_PLAN_VISION_JSON_PROMPT,
    );
  }

  let parsed = parseFloorPlanVisionJson(countRaw);
  if (parsed && legendParsed?.legend?.length && (!parsed.legend || parsed.legend.length === 0)) {
    parsed.legend = legendParsed.legend;
    parsed = reconcileFloorPlanTotals(parsed);
  }

  const formatted = formatFloorPlanVisionForPrompt(fileName, countRaw, parsed);
  const totals = parsed?.totals
    ? {
        fisheye: parsed.totals.fisheye ?? 0,
        multisensor: parsed.totals.multisensor ?? 0,
        dome: parsed.totals.dome ?? 0,
        total: parsed.totals.total_cameras ?? 0,
      }
    : null;

  return { formatted, totals };
}

function isImageMime(mime: string, fileName: string): boolean {
  return mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(fileName);
}

/**
 * Deep vision pass on attached floor plans (PNG/JPEG/PDF) before the Copilot turn.
 */
export async function prefetchAttachmentFloorPlanAnalysis(
  supabase: SupabaseClient,
  projectId: string,
  attachmentIds: string[],
  userMessage = "",
): Promise<string> {
  const inventoryMode = isSiteMapDeviceInventoryQuery(userMessage);
  if (!process.env.OPENAI_API_KEY || attachmentIds.length === 0) return "";

  const { data: rows } = await supabase
    .from("chat_attachments")
    .select("id, file_name, mime_type, storage_path, project_document_id")
    .eq("project_id", projectId)
    .in("id", attachmentIds);

  const blocks: string[] = [];
  const totalsLog: string[] = [];

  for (const row of rows ?? []) {
    const fileName = row.file_name as string;
    const mime = (row.mime_type as string) ?? "application/octet-stream";
    const storagePath = row.storage_path as string;
    const docId = row.project_document_id as string | null;

    if (isImageMime(mime, fileName)) {
      const { data: blob, error } = await supabase.storage
        .from("project-files")
        .download(storagePath);
      if (error || !blob) continue;

      const buffer = Buffer.from(await blob.arrayBuffer());
      if (inventoryMode) {
        const inv = await analyzeSiteMapInventory(buffer, mime, fileName);
        if (inv) blocks.push(inv);
      } else {
        const { formatted, totals } = await analyzeLayoutImageBuffer(buffer, mime, fileName);
        if (formatted) {
          blocks.push(formatted);
          if (totals) {
            totalsLog.push(
              `${fileName}: fisheye=${totals.fisheye} multisensor=${totals.multisensor} dome=${totals.dome} total=${totals.total}`,
            );
          }
        }
      }
      continue;
    }

    if (docId && (mime === "application/pdf" || fileName.toLowerCase().endsWith(".pdf"))) {
      const result = await inspectPlanPage(supabase, projectId, {
        documentId: docId,
        pageNumber: 1,
        focus: inventoryMode ? SITE_MAP_INVENTORY_JSON_PROMPT : FLOOR_PLAN_VISION_JSON_PROMPT,
      });
      if (result.success && result.summary.trim()) {
        const parsed = parseFloorPlanVisionJson(result.summary);
        blocks.push(
          formatFloorPlanVisionForPrompt(
            `${fileName} — page ${result.pageNumber}`,
            result.summary,
            parsed,
          ),
        );
        continue;
      }

      const { data: doc } = await supabase
        .from("project_documents")
        .select("storage_path")
        .eq("id", docId)
        .maybeSingle();
      if (doc?.storage_path) {
        const { data: pdfBlob } = await supabase.storage
          .from("project-files")
          .download(doc.storage_path);
        if (pdfBlob) {
          const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());
          const pageImage = await rasterizePdfPage(pdfBuffer, 1, planPageRenderScale());
          const { formatted, totals } = inventoryMode
            ? { formatted: await analyzeSiteMapInventory(pageImage, "image/png", fileName), totals: null }
            : await analyzeLayoutImageBuffer(pageImage, "image/png", fileName);
          if (formatted) {
            blocks.push(formatted);
            if (totals) {
              totalsLog.push(
                `${fileName}: fisheye=${totals.fisheye} multisensor=${totals.multisensor} dome=${totals.dome} total=${totals.total}`,
              );
            }
          }
        }
      }
    }
  }

  if (blocks.length === 0) return "";

  if (totalsLog.length > 0) {
    console.log(`[floor-plan-vision] ${totalsLog.join(" | ")}`);
  }

  const header = inventoryMode
    ? [
        "--- SITE MAP ANALYSIS (pre-loaded vision) ---",
        "Device counts from the legend summary at the bottom of the drawing (e.g. FCAM (15), RDR (3)). Use friendly names (Cameras, Readers) — not fisheye/dome unless the user asked for camera style.",
      ]
    : [
        "--- FLOOR PLAN ANALYSIS (pre-loaded vision) ---",
        "Authoritative legend-based symbol counts for per-location quoting.",
        "Do NOT replace these totals by counting \"360°\" text on the drawing.",
      ];

  return [...header, "", blocks.join("\n\n---\n\n")].join("\n");
}
