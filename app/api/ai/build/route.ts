import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeBuildMessage, TAX_MARKUP_NOTICE } from "@/lib/ai/analyzeBuildMessage";
import { parseBuildScope } from "@/lib/ai/parseBuildScope";
import type {
  BuildApiResponse,
  BuildMatchCard,
  BuildParseResponse,
  BuildRequestBody,
  BuildSpreadsheetContext,
  BuildUpdateResponse,
} from "@/lib/ai/buildTypes";
import {
  fetchOrganizationProducts,
  matchProductsForBuildItem,
} from "@/lib/buildProductMatch";
import { buildSpreadsheetContext } from "@/lib/buildSpreadsheetContext";
import type { BuildExplicitAdd } from "@/lib/applyBuildUpdates";
import {
  applyBuildUpdates,
  summarizeAppliedUpdates,
} from "@/lib/applyBuildUpdates";
import { computeSpreadsheetTotals } from "@/lib/spreadsheetLineItems";
import type { SpreadsheetSection } from "@/types/database";

export const maxDuration = 120;

async function loadSpreadsheet(
  supabase: Awaited<ReturnType<typeof createClient>>,
  spreadsheetId: string,
  projectId: string,
): Promise<{ sections: SpreadsheetSection[]; templateId: string | null; title: string } | null> {
  const { data, error } = await supabase
    .from("project_spreadsheets")
    .select("id, title, sections, template_id")
    .eq("id", spreadsheetId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    sections: (data.sections ?? []) as SpreadsheetSection[],
    templateId: data.template_id as string | null,
    title: data.title || "Untitled Spreadsheet",
  };
}

async function loadSpreadsheetContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  spreadsheetId: string,
  projectId: string,
): Promise<BuildSpreadsheetContext | null> {
  const sheet = await loadSpreadsheet(supabase, spreadsheetId, projectId);
  if (!sheet) return null;
  return buildSpreadsheetContext(
    spreadsheetId,
    sheet.title,
    sheet.sections,
    sheet.templateId,
  );
}

async function buildCardsFromExplicitAdds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  explicitAdds: BuildExplicitAdd[],
  organizationId: string | undefined,
): Promise<BuildMatchCard[]> {
  let catalogProducts: Awaited<ReturnType<typeof fetchOrganizationProducts>> | null = null;
  if (organizationId) {
    catalogProducts = await fetchOrganizationProducts(supabase, organizationId);
  }

  const cards: BuildMatchCard[] = [];

  for (const item of explicitAdds) {
    let primary = null;
    let alternatives: BuildMatchCard["alternatives"] = [];

    if (catalogProducts && (item.searchQuery || item.requestedLabel)) {
      const hits = matchProductsForBuildItem(
        catalogProducts.products,
        catalogProducts.familyMap,
        item.searchQuery,
        item.requestedLabel,
        3,
      );
      primary = hits[0] ?? null;
      alternatives = hits.slice(1, 3);
    }

    cards.push({
      itemId: crypto.randomUUID(),
      kind: "product",
      requestedLabel: item.requestedLabel,
      quantity: item.quantity,
      unit: item.unit,
      discountPercent: item.discountPercent,
      primary,
      alternatives,
    });
  }

  return cards;
}

async function buildCardsFromScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
  organizationId: string | undefined,
): Promise<BuildMatchCard[]> {
  const extracted = await parseBuildScope(message.trim());

  let catalogProducts: Awaited<ReturnType<typeof fetchOrganizationProducts>> | null = null;
  if (organizationId) {
    catalogProducts = await fetchOrganizationProducts(supabase, organizationId);
  }

  const cards: BuildMatchCard[] = [];

  for (const item of extracted) {
    let primary = null;
    let alternatives: BuildMatchCard["alternatives"] = [];

    if (catalogProducts && (item.searchQuery || item.requestedLabel)) {
      const hits = matchProductsForBuildItem(
        catalogProducts.products,
        catalogProducts.familyMap,
        item.searchQuery,
        item.requestedLabel,
        3,
      );
      primary = hits[0] ?? null;
      alternatives = hits.slice(1, 3);
    }

    if (item.kind === "labor_lump_sum") {
      cards.push({
        itemId: item.id,
        kind: item.kind,
        requestedLabel: item.requestedLabel,
        quantity: 1,
        unit: item.unit,
        discountPercent: item.discountPercent,
        primary,
        alternatives,
        lumpSumAmount: item.lumpSumAmount ?? 0,
      });
      continue;
    }

    cards.push({
      itemId: item.id,
      kind: item.kind,
      requestedLabel: item.requestedLabel,
      quantity: item.quantity,
      unit: item.unit,
      discountPercent: item.discountPercent,
      primary,
      alternatives,
    });
  }

  return cards;
}

function buildParseSummary(cards: BuildMatchCard[]): string {
  const productCount = cards.filter((c) => c.kind === "product").length;
  const laborCount = cards.filter((c) => c.kind === "labor_lump_sum").length;
  const matchableCount = productCount + laborCount;
  const matchedCount = cards.filter(
    (c) => (c.kind === "product" || c.kind === "labor_lump_sum") && c.primary,
  ).length;

  const summaryParts = [
    `Found **${cards.length}** line item${cards.length === 1 ? "" : "s"} from your scope`,
    matchableCount > 0 ? `(${matchedCount}/${matchableCount} matched in price book)` : "",
    laborCount > 0 ? `including ${laborCount} labor line${laborCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  return `${summaryParts.join(" ")}. Review each match below and click **+ Add to Quote** when ready.`;
}

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: BuildRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, activeSpreadsheetId, message } = body;
  const phase = body.phase ?? "auto";

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  if (!message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const { data: projectRow } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!projectRow) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const organizationId = projectRow.organization_id as string | undefined;
  const taxNotice = (extra?: string) =>
    extra ? `${TAX_MARKUP_NOTICE}\n\n_${extra}_` : TAX_MARKUP_NOTICE;

  try {
    const sheet =
      activeSpreadsheetId
        ? await loadSpreadsheet(supabase, activeSpreadsheetId, projectId)
        : null;

    const analyze =
      phase !== "parse"
        ? await analyzeBuildMessage(message.trim(), sheet?.sections ?? [])
        : { intent: "add" as const, updates: [], explicitAdds: [], taxOrMarkupRequested: false };

    const hasExplicitAdds = analyze.explicitAdds.length > 0;
    const wantsUpdate =
      analyze.intent === "update" ||
      (analyze.intent === "mixed" && analyze.updates.length > 0);
    const wantsScopeAdd =
      (analyze.intent === "add" || analyze.intent === "mixed") && !hasExplicitAdds;
    const wantsExplicitAdd =
      hasExplicitAdds && (analyze.intent === "add" || analyze.intent === "mixed");

    // --- Update existing spreadsheet lines ---
    if (wantsUpdate) {
      if (!activeSpreadsheetId || !sheet) {
        return NextResponse.json(
          {
            error:
              "Open a spreadsheet with line items first, then ask me to change quantities or discounts.",
          },
          { status: 400 },
        );
      }

      const { sections: updatedSections, applied } = applyBuildUpdates(
        sheet.sections,
        analyze.updates,
      );
      const { subtotal, total } = computeSpreadsheetTotals(updatedSections);

      const { data: saved, error: saveError } = await supabase
        .from("project_spreadsheets")
        .update({ sections: updatedSections, subtotal, total })
        .eq("id", activeSpreadsheetId)
        .select("id, title, sections, template_id")
        .single();

      if (saveError) throw saveError;

      let summary = summarizeAppliedUpdates(applied);
      if (analyze.taxOrMarkupRequested) {
        summary += `\n\n${taxNotice(analyze.taxMarkupSummary)}`;
      }

      const spreadsheetContext = buildSpreadsheetContext(
        saved.id,
        saved.title || sheet.title,
        (saved.sections ?? []) as SpreadsheetSection[],
        saved.template_id as string | null,
      );

      // Mixed: also return product cards for new items
      if (wantsExplicitAdd) {
        const cards = await buildCardsFromExplicitAdds(
          supabase,
          analyze.explicitAdds,
          organizationId,
        );
        const parsePart: BuildParseResponse = {
          kind: "parse",
          summary: buildParseSummary(cards),
          cards,
          spreadsheetContext,
          taxMarkupNotice: analyze.taxOrMarkupRequested ? taxNotice(analyze.taxMarkupSummary) : undefined,
        };

        const updatePart: BuildUpdateResponse = {
          kind: "update",
          summary,
          updatesApplied: applied.length,
          spreadsheetId: activeSpreadsheetId,
          sections: updatedSections,
          spreadsheetContext,
          taxMarkupNotice: analyze.taxOrMarkupRequested ? taxNotice(analyze.taxMarkupSummary) : undefined,
        };

        return NextResponse.json({ kind: "mixed", update: updatePart, parse: parsePart });
      }

      if (wantsScopeAdd && analyze.intent === "mixed") {
        const cards = await buildCardsFromScope(supabase, message.trim(), organizationId);
        const parsePart: BuildParseResponse = {
          kind: "parse",
          summary: buildParseSummary(cards),
          cards,
          spreadsheetContext,
          taxMarkupNotice: analyze.taxOrMarkupRequested ? taxNotice(analyze.taxMarkupSummary) : undefined,
        };

        const updatePart: BuildUpdateResponse = {
          kind: "update",
          summary,
          updatesApplied: applied.length,
          spreadsheetId: activeSpreadsheetId,
          sections: updatedSections,
          spreadsheetContext,
          taxMarkupNotice: analyze.taxOrMarkupRequested ? taxNotice(analyze.taxMarkupSummary) : undefined,
        };

        return NextResponse.json({ kind: "mixed", update: updatePart, parse: parsePart });
      }

      const response: BuildUpdateResponse = {
        kind: "update",
        summary,
        updatesApplied: applied.length,
        spreadsheetId: activeSpreadsheetId,
        sections: updatedSections,
        spreadsheetContext,
        taxMarkupNotice: analyze.taxOrMarkupRequested ? taxNotice(analyze.taxMarkupSummary) : undefined,
      };

      return NextResponse.json(response);
    }

    // Tax/markup only (no line updates, no new products)
    if (analyze.taxOrMarkupRequested && !wantsScopeAdd && !wantsExplicitAdd) {
      const response: BuildUpdateResponse = {
        kind: "update",
        summary: taxNotice(analyze.taxMarkupSummary),
        updatesApplied: 0,
        spreadsheetId: activeSpreadsheetId ?? "",
        sections: sheet?.sections ?? [],
        spreadsheetContext:
          (activeSpreadsheetId
            ? await loadSpreadsheetContext(supabase, activeSpreadsheetId, projectId)
            : null) ?? undefined,
        taxMarkupNotice: taxNotice(analyze.taxMarkupSummary),
      };
      return NextResponse.json(response);
    }

    // --- Add new products (explicit request or scope parse) ---
    const cards = wantsExplicitAdd
      ? await buildCardsFromExplicitAdds(supabase, analyze.explicitAdds, organizationId)
      : await buildCardsFromScope(supabase, message.trim(), organizationId);

    let spreadsheetContext: BuildSpreadsheetContext | undefined;
    if (activeSpreadsheetId) {
      const ctx = await loadSpreadsheetContext(supabase, activeSpreadsheetId, projectId);
      if (ctx) spreadsheetContext = ctx;
    }

    let summary = buildParseSummary(cards);
    if (analyze.taxOrMarkupRequested) {
      summary += `\n\n${taxNotice(analyze.taxMarkupSummary)}`;
    }

    const response: BuildParseResponse = {
      kind: "parse",
      summary,
      cards,
      spreadsheetContext,
      taxMarkupNotice: analyze.taxOrMarkupRequested ? taxNotice(analyze.taxMarkupSummary) : undefined,
    };

    return NextResponse.json(response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Build request failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
