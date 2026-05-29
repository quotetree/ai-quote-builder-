/**
 * Floor-plan vision: legend-first symbol counting (avoids 360° / fisheye conflation).
 */

export const FLOOR_PLAN_FILENAME_RE =
  /\b(floor\s*plan|floorplan|site\s*map|sitemap|architectural|layout|riser|elevation)\b/i;

export function isLikelyFloorPlanFileName(fileName: string): boolean {
  return FLOOR_PLAN_FILENAME_RE.test(fileName);
}

/** OpenAI vision image block — high detail required for small symbols on large sheets. */
export function floorPlanVisionImageUrl(
  base64: string,
  mimeType: string,
): { url: string; detail: "high" } {
  const mime = mimeType.startsWith("image/") ? mimeType : "image/png";
  return { url: `data:${mime};base64,${base64}`, detail: "high" };
}

const LAYOUT_COUNTING_RULES = `CRITICAL — follow the LEGEND, not coverage words on the drawing:
- Count only camera MARKERS that match a symbol code/shape in the CCTV/security LEGEND.
- Do NOT treat the words "360", "360°", "180°", or "panoramic" printed near cameras as a symbol type. Those describe field of view, not which icon was placed.
- Do NOT classify every circular icon as fisheye/360. Domes, multisensors, and fisheyes are different legend entries — match the exact icon shape/code.
- Fisheye count = markers whose LEGEND row says fisheye / fish-eye / FCAM (or equivalent), NOT "any camera that could see 360°".
- Walk the plan room-by-room; for each room list symbol code → qty → quote style from legend only.`;

const INVENTORY_COUNTING_RULES = `CRITICAL — every site map legend is different. Adapt to what YOU see:

**Find the legend first** (often bottom, bottom-left, or margin — not always the same place).

**Two common legend formats (detect which applies):**
1. **Quantity summary** — each row shows a symbol code and installed count, e.g. "CODE (15)", "CODE (3)". The number in parentheses is the quantity on site.
2. **Symbol key only** — each row defines an icon; "(1)" may mean "one symbol type" NOT site quantity. You MUST count every icon instance on the aerial/map.

**Always:**
- Count placed icons on the drawing for each symbol code (do not skip duplicates).
- Read legend text for device_type from the label (camera, reader, dome, rack, panel, switch, etc.).
- For inventory answers use friendly names: Cameras, Readers, Dome cameras — NOT fisheye/360 unless the user asked for camera *style* quoting.
- Shaded FOV arcs (180°, 90°, full circle) show coverage — they are NOT extra cameras.
- If legend quantity and icon count disagree, report both in warnings.`;

export const SITE_MAP_LEGEND_QTY_PROMPT = `This crop may contain part of a security/low-voltage site map LEGEND.

Transcribe every symbol row you see: symbol_code, legend_label (exact text), and qty if the legend lists an installed quantity in parentheses.

Examples of quantity-summary legends: "ABC (15)" = 15 of that code. Examples of symbol-key legends: only icon + name — leave qty null if no clear total.

JSON only:
{
  "legend_summary": [
    { "symbol_code": "CODE", "qty": 0, "legend_label": "exact text from legend" }
  ],
  "warnings": "optional — note if this crop has no legend"
}`;

export const SITE_MAP_INVENTORY_JSON_PROMPT = `Read this site map / floor plan and produce a security device inventory.

${INVENTORY_COUNTING_RULES}

Steps:
1. Find and read the legend (any edge of the drawing).
2. Fill legend_summary from the legend when quantities are listed; otherwise leave qty null.
3. Count every placed icon on the map per symbol_code.
4. symbol_counts: final quantity per code (use legend qty when it is clearly a summary; otherwise use icon count).

JSON only:
{
  "legend_summary": [{ "symbol_code": "CODE", "qty": 0, "legend_label": "label text" }],
  "legend": [{ "symbol_code": "CODE", "device_type": "camera|reader|rack|other", "legend_label": "text" }],
  "symbol_counts": [{ "symbol_code": "CODE", "device_type": "camera", "qty": 0 }],
  "warnings": "optional"
}`;

export const FLOOR_PLAN_LEGEND_JSON_PROMPT = `Read the CCTV/security LEGEND on this floor plan only.

${LAYOUT_COUNTING_RULES}

List every distinct camera SYMBOL (shape or code) in the legend and the quote style for each. Do not count markers on the plan yet.

JSON only:
{
  "legend": [
    { "symbol_code": "D1", "quote_style": "dome", "legend_label": "exact legend text" }
  ],
  "warnings": "optional"
}`;

export const FLOOR_PLAN_VISION_JSON_PROMPT = `Read this architectural floor plan or site map as a security/low-voltage estimator.

${LAYOUT_COUNTING_RULES}

Steps:
1. Read the CCTV/security LEGEND. List each symbol code/icon and quote style (fisheye, multisensor, dome, bullet, PTZ, other).
2. Scan the drawing. For each labeled room/area, count markers by SYMBOL CODE from the legend — not by "360°" text nearby.
3. In by_location, set symbol_code only; quote_style must match the legend row for that code.
4. Sum totals from your room counts.

JSON only:
{
  "legend": [
    { "symbol_code": "D1", "quote_style": "dome", "legend_label": "text from legend row" }
  ],
  "by_location": [
    {
      "location": "Room name",
      "markers": [{ "symbol_code": "D1", "qty": 1 }]
    }
  ],
  "totals": {
    "fisheye": 0,
    "multisensor": 0,
    "dome": 0,
    "bullet_other": 0,
    "total_cameras": 0
  },
  "warnings": "optional"
}`;

export function buildFloorPlanCountPrompt(legendJson: string): string {
  return `You already extracted this legend from the same drawing:

${legendJson}

Now count every camera MARKER on the plan.

${LAYOUT_COUNTING_RULES}

Rules:
- Each marker's symbol_code MUST appear in the legend above.
- Do NOT assign quote_style from "360", "360°", or "panoramic" labels on the drawing.
- quote_style for each marker comes ONLY from the legend row for its symbol_code.
- Most markers are usually dome — only count fisheye where the legend icon/code is specifically fisheye/fish-eye.

Return the full JSON (legend, by_location, totals, warnings).`;
}

/** @deprecated Use FLOOR_PLAN_VISION_JSON_PROMPT — kept for inspect_plan_page focus strings */
export const FLOOR_PLAN_VISION_FOCUS = `${LAYOUT_COUNTING_RULES}

Find the legend, count every camera symbol by room, and provide totals by style (fisheye / multisensor / dome / other).`;

export interface FloorPlanVisionJson {
  legend_summary?: {
    symbol_code?: string;
    qty?: number;
    legend_label?: string;
  }[];
  legend?: {
    symbol_code?: string;
    quote_style?: string;
    device_type?: string;
    legend_label?: string;
  }[];
  symbol_counts?: {
    symbol_code?: string;
    device_type?: string;
    qty?: number;
  }[];
  by_location?: {
    location?: string;
    markers?: { symbol_code?: string; qty?: number; quote_style?: string }[];
  }[];
  totals?: {
    fisheye?: number;
    multisensor?: number;
    dome?: number;
    bullet_other?: number;
    total_cameras?: number;
  };
  warnings?: string;
}

type QuoteStyleKey = "fisheye" | "multisensor" | "dome" | "bullet_other";

/** Friendly device bucket for site-map inventory (label text first — codes vary by vendor). */
export function deviceTypeFromSymbol(
  symbolCode: string,
  legendLabel?: string,
): string {
  const label = (legendLabel ?? "").toLowerCase();
  const code = symbolCode.trim().toUpperCase();

  if (/\breader|card\s*reader|badge\b/.test(label) || /\bRDR|READER|CR\b/.test(code)) {
    return "reader";
  }
  if (/\baccess\s*control|acs|panel|controller\b/.test(label) || /\bACS|AGC|ACCTL|ACP|ACU\b/.test(code)) {
    return "access_control_panel";
  }
  if (/\brack|head\s*end|idf|mdf\b/.test(label) || /\bRACK|IDF|MDF\b/.test(code)) {
    return "rack";
  }
  if (/\bmultisensor|multi[\s-]?sensor\b/.test(label)) return "multisensor";
  if (/\bdome\b/.test(label)) return "dome";
  if (/\bbullet|ptz\b/.test(label)) return "bullet";
  if (
    /\bcamera|cctv|surveillance|fish[\s-]?eye|fisheye|dome|bullet|ptz|cam\b/.test(label) ||
    /\bFCAM|CAM|CCTV|CAMERA|DOME|PTZ\b/.test(code)
  ) {
    return "camera";
  }
  if (/\bswitch|poe|nvr|dvr|gw|gateway\b/.test(label)) return "other";
  return "other";
}

export function friendlyDeviceName(deviceType: string, qty: number): string {
  const plural = qty === 1 ? "" : "s";
  switch (deviceType) {
    case "camera":
      return `Camera${plural}`;
    case "reader":
      return `Reader${plural}`;
    case "rack":
      return `Rack${plural}`;
    case "access_control_panel":
      return qty === 1 ? "Access control panel" : "Access control panels";
    case "multisensor":
      return `Multisensor camera${plural}`;
    default:
      return deviceType;
  }
}

function normalizeQuoteStyle(raw: string | undefined): QuoteStyleKey | null {
  const s = (raw ?? "").toLowerCase();
  if (/\bfish[\s-]?eye|fisheye\b/.test(s)) return "fisheye";
  if (/\bmultisensor|multi[\s-]?sensor\b/.test(s)) return "multisensor";
  if (/\bdome\b/.test(s)) return "dome";
  if (/\b(bullet|ptz)\b/.test(s)) return "bullet_other";
  return null;
}

function sumMarkers(
  byLocation: NonNullable<FloorPlanVisionJson["by_location"]>,
  styleBySymbol: Map<string, QuoteStyleKey>,
): Record<QuoteStyleKey, number> & { total: number } {
  const sums: Record<QuoteStyleKey, number> & { total: number } = {
    fisheye: 0,
    multisensor: 0,
    dome: 0,
    bullet_other: 0,
    total: 0,
  };

  for (const loc of byLocation) {
    for (const m of loc.markers ?? []) {
      const qty = typeof m.qty === "number" && m.qty > 0 ? m.qty : 0;
      if (qty === 0) continue;
      const code = (m.symbol_code ?? "").trim().toUpperCase();
      const style =
        (code ? styleBySymbol.get(code) : null) ??
        normalizeQuoteStyle(m.quote_style) ??
        "dome";
      sums[style] += qty;
      sums.total += qty;
    }
  }
  return sums;
}

/**
 * Lock each marker's style to the legend symbol table, then re-sum totals from rooms.
 */
export function reconcileFloorPlanTotals(
  parsed: FloorPlanVisionJson | null,
): FloorPlanVisionJson | null {
  if (!parsed) return parsed;

  const styleBySymbol = new Map<string, QuoteStyleKey>();
  for (const row of parsed.legend ?? []) {
    const code = (row.symbol_code ?? "").trim().toUpperCase();
    const style = normalizeQuoteStyle(row.quote_style);
    if (code && style) styleBySymbol.set(code, style);
  }

  for (const loc of parsed.by_location ?? []) {
    for (const m of loc.markers ?? []) {
      const code = (m.symbol_code ?? "").trim().toUpperCase();
      if (code && styleBySymbol.has(code)) {
        m.quote_style = styleBySymbol.get(code)!;
      }
    }
  }

  if (!parsed.by_location?.length) return parsed;

  const sums = sumMarkers(parsed.by_location, styleBySymbol);
  if (sums.total === 0) return parsed;

  const declared = parsed.totals ?? {};
  const declaredFisheye = declared.fisheye ?? 0;
  if (declaredFisheye !== sums.fisheye) {
    const note = `Totals adjusted from room counts (was fisheye=${declaredFisheye}, now fisheye=${sums.fisheye}).`;
    parsed.warnings = parsed.warnings ? `${parsed.warnings} ${note}` : note;
  }

  parsed.totals = {
    fisheye: sums.fisheye,
    multisensor: sums.multisensor,
    dome: sums.dome,
    bullet_other: sums.bullet_other,
    total_cameras: sums.total,
  };

  return parsed;
}

/** Parse ## Totals section from formatted vision (for Tavily style selection). */
export function parseTotalsFromFormattedVision(block: string): {
  fisheye: number;
  multisensor: number;
  dome: number;
  total: number;
} {
  const fisheye = /-\s*Fisheye:\s*(\d+)/i.exec(block)?.[1];
  const multisensor = /-\s*Multisensor:\s*(\d+)/i.exec(block)?.[1];
  const dome = /-\s*Dome:\s*(\d+)/i.exec(block)?.[1];
  const total = /-\s*\*?\*?Total cameras:\s*(\d+)/i.exec(block)?.[1];
  return {
    fisheye: fisheye ? Number(fisheye) : 0,
    multisensor: multisensor ? Number(multisensor) : 0,
    dome: dome ? Number(dome) : 0,
    total: total ? Number(total) : 0,
  };
}

/** Parse quantity from legend text like "RDR (3)" or "FCAM (15)". */
export function parseQtyFromLegendLabel(legendLabel: string): number | null {
  const matches = [...legendLabel.matchAll(/\((\d+)\)/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1]![1];
  const n = Number(last);
  return Number.isFinite(n) ? n : null;
}

/**
 * Merge legend quantity vs marker count — works for both legend formats.
 * - Summary legend CODE (15) → trust 15
 * - Symbol-key legend CODE (1) but 3 icons on map → trust 3
 */
export function resolveSymbolQuantity(
  legendQty: number | null,
  markerQty: number,
): { qty: number; source: "legend_summary" | "marker_count" } {
  if (legendQty == null || !Number.isFinite(legendQty)) {
    return { qty: Math.max(0, markerQty), source: "marker_count" };
  }
  if (markerQty <= 0) {
    return { qty: legendQty, source: "legend_summary" };
  }
  if (legendQty > 1) {
    return { qty: legendQty, source: "legend_summary" };
  }
  if (legendQty === 1 && markerQty > 1) {
    return { qty: markerQty, source: "marker_count" };
  }
  return { qty: legendQty, source: "legend_summary" };
}

/**
 * Reconcile legend crops + full-map vision into final symbol_counts.
 */
export function reconcileInventoryCounts(
  parsed: FloorPlanVisionJson | null,
  legendStrip?: FloorPlanVisionJson | null,
): FloorPlanVisionJson | null {
  if (!parsed) return parsed;

  const byCode = new Map<
    string,
    { device_type: string; qty: number; legend_label: string; source: string }
  >();

  const ingestSummary = (
    rows: { symbol_code?: string; qty?: number; legend_label?: string }[] | undefined,
    source: string,
  ) => {
    for (const row of rows ?? []) {
      const code = (row.symbol_code ?? "").trim().toUpperCase();
      if (!code) continue;
      const fromLabel = parseQtyFromLegendLabel(row.legend_label ?? "");
      const qty =
        typeof row.qty === "number" && row.qty >= 0
          ? row.qty
          : fromLabel != null
            ? fromLabel
            : null;
      if (qty == null) continue;
      byCode.set(code, {
        device_type: deviceTypeFromSymbol(code, row.legend_label),
        qty,
        legend_label: row.legend_label ?? `${code} (${qty})`,
        source,
      });
    }
  };

  ingestSummary(legendStrip?.legend_summary, "legend_strip");
  ingestSummary(parsed.legend_summary, "legend_summary");
  ingestSummary(
    parsed.legend?.map((l) => ({
      symbol_code: l.symbol_code,
      qty: parseQtyFromLegendLabel(l.legend_label ?? "") ?? undefined,
      legend_label: l.legend_label,
    })),
    "legend_row",
  );

  const warnings: string[] = parsed.warnings ? [parsed.warnings] : [];

  for (const row of parsed.symbol_counts ?? []) {
    const code = (row.symbol_code ?? "").trim().toUpperCase();
    if (!code) continue;
    const markerQty = typeof row.qty === "number" ? row.qty : 0;
    const existing = byCode.get(code);
    const label =
      existing?.legend_label ??
      parsed.legend?.find((l) => (l.symbol_code ?? "").toUpperCase() === code)?.legend_label;

    if (!existing) {
      if (markerQty > 0) {
        byCode.set(code, {
          device_type: row.device_type ?? deviceTypeFromSymbol(code, label),
          qty: markerQty,
          legend_label: label ?? `${code} (${markerQty})`,
          source: "marker_count",
        });
      }
      continue;
    }

    const legendQty = parseQtyFromLegendLabel(existing.legend_label) ?? existing.qty;
    const resolved = resolveSymbolQuantity(legendQty, markerQty);
    if (markerQty > 0 && resolved.qty !== markerQty && resolved.qty !== legendQty) {
      warnings.push(
        `${code}: legend implies ${legendQty}, counted ${markerQty} icons — using ${resolved.qty} (${resolved.source}).`,
      );
    } else if (markerQty > 0 && markerQty !== existing.qty) {
      warnings.push(
        `${code}: adjusted to ${resolved.qty} (${resolved.source}; legend ${legendQty}, markers ${markerQty}).`,
      );
    }
    existing.qty = resolved.qty;
    existing.source = resolved.source;
  }

  parsed.symbol_counts = [...byCode.entries()].map(([code, v]) => ({
    symbol_code: code,
    device_type: v.device_type,
    qty: v.qty,
  }));

  if (warnings.length > 0) {
    parsed.warnings = [...new Set(warnings)].join(" ");
  }

  return parsed;
}

export function parseFloorPlanVisionJson(raw: string): FloorPlanVisionJson | null {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as FloorPlanVisionJson;
    if (parsed.symbol_counts?.length || parsed.legend_summary?.length) {
      const reconciled = reconcileInventoryCounts(parsed);
      if (reconciled?.symbol_counts?.length) {
        for (const row of reconciled.symbol_counts) {
          const label = reconciled.legend?.find(
            (l) =>
              (l.symbol_code ?? "").toUpperCase() === (row.symbol_code ?? "").toUpperCase(),
          )?.legend_label;
          row.device_type =
            row.device_type ?? deviceTypeFromSymbol(row.symbol_code ?? "", label);
        }
      }
      return reconciled;
    }
    return reconcileFloorPlanTotals(parsed);
  } catch {
    return null;
  }
}

export function formatSiteMapInventoryForPrompt(
  fileName: string,
  parsed: FloorPlanVisionJson | null,
): string {
  if (!parsed?.symbol_counts?.length) {
    return "";
  }

  const legendRows =
    parsed.legend
      ?.map((r) => {
        const dt = r.device_type ?? deviceTypeFromSymbol(r.symbol_code ?? "", r.legend_label);
        return `| ${r.symbol_code ?? "?"} | ${friendlyDeviceName(dt, 1)} | ${r.legend_label ?? ""} |`;
      })
      .join("\n") ?? "";

  const countRows = parsed.symbol_counts
    .filter((s) => (s.qty ?? 0) > 0)
    .map((s) => {
      const dt = s.device_type ?? deviceTypeFromSymbol(s.symbol_code ?? "");
      const qty = s.qty ?? 0;
      return `| ${s.symbol_code ?? "?"} | ${friendlyDeviceName(dt, qty)} | ${qty} |`;
    })
    .join("\n");

  const cameraQty = parsed.symbol_counts
    .filter((s) => (s.device_type ?? deviceTypeFromSymbol(s.symbol_code ?? "")) === "camera")
    .reduce((n, s) => n + (s.qty ?? 0), 0);

  return [
    `### ${fileName} (site map inventory — counted on drawing)`,
    "",
    parsed.warnings ? `**Note:** ${parsed.warnings}` : "",
    "",
    "## Legend (symbol definitions)",
    "| Code | Device type | Label on drawing |",
    legendRows,
    "",
    "## Counts on site (authoritative)",
    "| Code | Device type | Quantity |",
    countRows,
    "",
    "## Summary for answer",
    `- Report **Cameras: ${cameraQty}** when device_type is camera — do not say "fisheye" unless user asked for style.`,
    "- Report each symbol_count row using friendly device names from legend labels on this drawing.",
    "- Quantities are reconciled: summary legends use parenthetical totals; symbol-key legends use icon counts.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatFloorPlanVisionForPrompt(
  fileName: string,
  rawModelText: string,
  parsed: FloorPlanVisionJson | null,
): string {
  if (parsed?.symbol_counts?.length) {
    const inv = formatSiteMapInventoryForPrompt(fileName, parsed);
    if (inv) return inv;
  }

  if (!parsed?.totals) {
    return rawModelText;
  }

  const t = parsed.totals;
  const legendRows =
    parsed.legend
      ?.map(
        (r) =>
          `| ${r.symbol_code ?? "?"} | ${r.quote_style ?? "?"} | ${r.legend_label ?? ""} |`,
      )
      .join("\n") ?? "";

  const locationRows =
    parsed.by_location
      ?.map((loc) => {
        const markers =
          loc.markers
            ?.map((m) => `${m.symbol_code ?? "?"}×${m.qty ?? 0} (${m.quote_style ?? "?"})`)
            .join(", ") ?? "";
        return `| ${loc.location ?? "?"} | ${markers} |`;
      })
      .join("\n") ?? "";

  return [
    `### ${fileName} (floor plan vision — legend-based count)`,
    "",
    parsed.warnings ? `**Note:** ${parsed.warnings}` : "",
    "",
    "## Legend",
    "| Symbol | Quote style | Legend label |",
    legendRows || "| (see raw) | | |",
    "",
    "## By location",
    "| Room / area | Markers (qty) |",
    locationRows || "| (see raw) | |",
    "",
    "## Totals (authoritative)",
    `- Fisheye: ${t.fisheye ?? 0}`,
    `- Multisensor: ${t.multisensor ?? 0}`,
    `- Dome: ${t.dome ?? 0}`,
    `- Bullet / other: ${t.bullet_other ?? 0}`,
    `- **Total cameras: ${t.total_cameras ?? 0}**`,
    "",
    "<!-- Do not re-count using 360° annotations; use legend symbol codes only. -->",
  ]
    .filter(Boolean)
    .join("\n");
}
