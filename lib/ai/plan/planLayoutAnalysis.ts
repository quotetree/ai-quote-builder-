/**
 * Floor plan / site map camera layout questions (symbols, legend, per-room quoting).
 */

import type { ChatTurn } from "@/lib/ai/plan/webResearchContext";

export { FLOOR_PLAN_VISION_FOCUS } from "@/lib/ai/plan/floorPlanVision";

/** Drop prior assistant turns that anchor wrong fisheye / 360° counts when re-running layout analysis. */
export function filterPlanLayoutHistory(history: ChatTurn[]): ChatTurn[] {
  return history.filter((m) => {
    if (m.role !== "assistant") return true;
    const c = m.content;
    const looksLikeCameraCountAnswer =
      /\b(fish[\s-]?eye|fisheye|multisensor|dome)\b/i.test(c) &&
      /\b(location|room|quote|total|camera)/i.test(c);
    const mentions360Count =
      /\b360[- ]?degree\b/i.test(c) && /\b(camera|fish[\s-]?eye)/i.test(c);
    return !(looksLikeCameraCountAnswer || mentions360Count);
  });
}

/**
 * Simple site-map / legend device tally (cameras, readers, panels) — NOT per-room quoting style.
 */
export function isSiteMapDeviceInventoryQuery(text: string): boolean {
  const msg = text.trim();
  if (!msg) return false;

  const onMap =
    /\b(site\s*map|floor\s*plan|floorplan|uploaded|attached|drawing|blueprint|legend)\b/i.test(
      msg,
    );
  const wantsInventory =
    /\b(how many|count|total|totals|quantity|quantities|list|tally|what.+on (?:the )?(?:map|plan|drawing))\b/i.test(
      msg,
    ) ||
    /\b(based on|from|per) (?:the )?(?:legend|site\s*map)\b/i.test(msg) ||
    /\b(cameras?|readers?|rack|access control|devices?|hardware|equipment)\b/i.test(msg);

  const wantsQuotingStyle =
    /\b(which (?:style|type)|what (?:style|type)|should i (?:quote|use)|quote at each|per (?:room|location)|fisheye|multisensor|dome)\b/i.test(
      msg,
    );

  return onMap && wantsInventory && !wantsQuotingStyle;
}

/** Per-location camera *style* quoting (fisheye vs dome etc.) — not simple legend counts. */
export function isPlanLayoutCameraQuery(text: string): boolean {
  const msg = text.trim();
  if (!msg || isSiteMapDeviceInventoryQuery(msg)) return false;

  const planDrawing =
    /\b(site\s*map|floor\s*plan|floorplan|floor\s*layout|architectural\s*plan|drawing|blueprint)\b/i.test(
      msg,
    );

  const layoutQuestion =
    /\b(which (?:style|type)|what (?:style|type)|should i (?:quote|use)|at each location|per (?:room|location)|quote at)\b/i.test(
      msg,
    );

  return (
    (layoutQuestion && /\b(camera|cctv|surveillance)\b/i.test(msg)) ||
    (planDrawing &&
      /\b(quote|quoting)\b/i.test(msg) &&
      /\b(style|type|location|room)\b/i.test(msg))
  );
}

export function siteMapInventoryInstructions(fileNames: string[]): string {
  const files =
    fileNames.length > 0 ? fileNames.join(", ") : "the attached site map / floor plan";
  return [
    "--- SITE MAP DEVICE INVENTORY ---",
    `The user wants a **device count from the legend** on **${files}** — like a security takeoff summary.`,
    "",
    "Use the pre-loaded SITE MAP ANALYSIS counts (counted on the drawing).",
    "",
    "**Answer format (match a clear takeoff):**",
    "- Brief intro referencing where the legend is on this drawing.",
    "- Bullets: **SYMBOL (friendly name):** qty — use whatever codes appear on THIS map (not a fixed template).",
    "- Table: **Device type** | **Quantity** — Cameras, Readers, Panels, Racks, etc.",
    "- One-line total for security field devices if helpful.",
    "",
    "**Do NOT:**",
    "- Assume a fixed legend layout or symbol list — read what is on this drawing only.",
    '- Relabel all cameras as "fisheye" because the legend mentions fisheye — use **Cameras** for inventory unless the user asked for style quoting.',
    "- Run product research or recommend SKUs unless asked.",
  ].join("\n");
}

export function floorPlanModeInstructions(fileNames: string[]): string {
  const files =
    fileNames.length > 0 ? fileNames.join(", ") : "the attached floor plan / site map";
  return [
    "--- FLOOR PLAN + QUOTING RESEARCH MODE ---",
    `The user attached **${files}** and wants a **complete, well-researched quoting answer**: what to quote at **each location** on the plan.`,
    "",
    "You have two pre-loaded inputs — use **both**:",
    "1. **Floor plan vision** (in the user message under `FLOOR PLAN ANALYSIS`) — **authoritative** legend-based counts. Do NOT override these totals using generic attachment summaries or by counting \"360°\" text on the drawing.",
    "2. **Manufacturer / product research (Tavily)** — model names, MP, form factor, official specs.",
    "",
    "Use web_search for gaps. Use search_price_book **only** if the user asked about your price book / catalog / what you sell.",
    "If vision totals look wrong, call inspect_plan_page once to re-read the legend — do not guess from FOV labels like 360°.",
    "Do not stop after step 1.",
    "",
    "**Required final answer structure:**",
    "## Executive summary",
    "2–3 sentences: total cameras, mix by style, and quoting approach.",
    "",
    "## Plan legend & counts",
    "Legend table + per-room table + **grand totals** (must match the vision analysis).",
    "",
    "## Quoting recommendation by location",
    "For **every room/area on the plan**, a row with:",
    "| Location | Qty | Style from plan | Recommended model(s) to quote | MP / notes | Source (price book vs manufacturer) |",
    "",
    "## Price book matches",
    "Include this section **only** if the user asked about your price book / catalog. Otherwise omit.",
    "",
    "## Manufacturer spec highlights",
    "Key model lines from web research (e.g. which Verkada series = fisheye vs multisensor vs dome).",
    "",
    "## General considerations",
    "Brief install/FOV/lighting notes **only** where relevant to specific rooms on this plan.",
    "",
    "**Do NOT:**",
    "- Stop after counting symbols without product research.",
    "- Give one generic camera type for every room without reading the legend.",
    "- Count fisheye by matching legend fisheye symbols only — never by counting \"360\" or \"360°\" words on the plan.",
    "- Ignore earlier assistant replies in this chat about fisheye or 360° counts if they differ from FLOOR PLAN ANALYSIS.",
    "- Omit any labeled room on the plan.",
    "- Tell the user to check a website instead of naming models.",
  ].join("\n");
}
