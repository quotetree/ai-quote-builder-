import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ProjectSpreadsheet,
  Quote,
  QuoteItem,
  SpreadsheetRow,
  SpreadsheetSection,
} from "@/types/database";
import type {
  QuoteContextActiveSpreadsheet,
  QuoteContextLineItem,
  QuoteContextQuoteSummary,
  QuoteContextResult,
  QuoteContextSpreadsheetSummary,
} from "./quoteContextTypes";

const MAX_LINE_ITEMS = 200;
const MAX_RECENT_QUOTES = 5;
const SCOPE_PREVIEW_LEN = 200;

function flattenSections(sections: SpreadsheetSection[]): QuoteContextLineItem[] {
  const items: QuoteContextLineItem[] = [];
  for (const section of sections ?? []) {
    for (const row of section.rows ?? []) {
      items.push(rowToLineItem(section.label, row));
    }
  }
  return items;
}

function rowToLineItem(sectionLabel: string, row: SpreadsheetRow): QuoteContextLineItem {
  const label =
    row.custom_label?.trim() ||
    row.product_name?.trim() ||
    "Unnamed line";
  return {
    sectionLabel: sectionLabel || "Section",
    label,
    productName: row.product_name ?? "",
    productCode: row.product_code ?? "",
    quantity: row.quantity ?? 0,
    salesPrice: row.sales_price ?? 0,
    listPrice: row.list_price ?? 0,
    discountPercent: row.discount ?? 0,
  };
}

function summarizeSpreadsheet(sheet: ProjectSpreadsheet): QuoteContextSpreadsheetSummary {
  const sections = (sheet.sections ?? []) as SpreadsheetSection[];
  const rowCount = sections.reduce((n, s) => n + (s.rows?.length ?? 0), 0);
  return {
    id: sheet.id,
    title: sheet.title || "Untitled spreadsheet",
    rowCount,
    sectionCount: sections.length,
    subtotal: Number(sheet.subtotal) || 0,
    total: Number(sheet.total) || 0,
  };
}

function buildActiveSpreadsheet(sheet: ProjectSpreadsheet): QuoteContextActiveSpreadsheet {
  const sections = (sheet.sections ?? []) as SpreadsheetSection[];
  const allItems = flattenSections(sections);
  const lineItems = allItems.slice(0, MAX_LINE_ITEMS);
  const summary = summarizeSpreadsheet(sheet);
  return {
    ...summary,
    sections,
    lineItems,
    lineItemsTruncated: allItems.length > MAX_LINE_ITEMS,
  };
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function buildPromptText(result: Omit<QuoteContextResult, "promptText">): string {
  const lines: string[] = [
    `# Project: ${result.projectName}`,
    `Project ID: ${result.projectId}`,
  ];

  if (result.productFamilies.length > 0) {
    lines.push(`Product families: ${result.productFamilies.join(", ")}`);
  }

  lines.push(
    "",
    "## IMPORTANT",
    "Spreadsheet and quote figures are REFERENCE ONLY. Do not generate, modify, or recommend changing pricing in the spreadsheet.",
    "",
  );

  if (result.spreadsheetSummaries.length > 0) {
    lines.push("## Spreadsheets in this project");
    for (const s of result.spreadsheetSummaries) {
      lines.push(
        `- ${s.title} (${s.rowCount} rows, ${s.sectionCount} sections) — subtotal ${formatMoney(s.subtotal)}, total ${formatMoney(s.total)}`,
      );
    }
    lines.push("");
  }

  if (result.activeSpreadsheet) {
    const a = result.activeSpreadsheet;
    lines.push(`## Active spreadsheet: ${a.title}`);
    lines.push(`Subtotal: ${formatMoney(a.subtotal)} | Total: ${formatMoney(a.total)}`);
    if (a.lineItemsTruncated) {
      lines.push(`(Showing first ${MAX_LINE_ITEMS} line items; ${a.rowCount} total rows in sheet.)`);
    }
    lines.push("");
    for (const item of a.lineItems) {
      lines.push(
        `- [${item.sectionLabel}] ${item.label} | code: ${item.productCode || "—"} | qty: ${item.quantity} | ref. unit: ${formatMoney(item.salesPrice)}`,
      );
    }
    lines.push("");
  } else {
    lines.push("## Active spreadsheet", "(none selected — user is not editing a spreadsheet)", "");
  }

  if (result.recentQuotes.length > 0) {
    lines.push("## Recent quotes (log)");
    for (const q of result.recentQuotes) {
      lines.push(
        `- ${q.quoteName} #${q.quoteNumber} v${q.versionNumber} (${q.status}) — ${q.itemCount} items, total ${formatMoney(q.totalPrice)}${q.spreadsheetId ? ", linked to spreadsheet" : ""}`,
      );
      if (q.scopePreview) {
        lines.push(`  Scope excerpt: ${q.scopePreview}`);
      }
    }
  }

  return lines.join("\n");
}

export async function buildQuoteContext(
  supabase: SupabaseClient,
  projectId: string,
  activeSpreadsheetId?: string | null,
): Promise<QuoteContextResult | null> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, project_name, product_families")
    .eq("id", projectId)
    .single();

  if (projectError || !project) {
    return null;
  }

  const { data: spreadsheets } = await supabase
    .from("project_spreadsheets")
    .select("id, project_id, title, sections, subtotal, total, charges, baked_markups")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  const sheets = (spreadsheets ?? []) as ProjectSpreadsheet[];
  const spreadsheetSummaries = sheets.map(summarizeSpreadsheet);

  let activeSpreadsheet: QuoteContextActiveSpreadsheet | null = null;
  if (activeSpreadsheetId) {
    const active = sheets.find((s) => s.id === activeSpreadsheetId);
    if (active) {
      activeSpreadsheet = buildActiveSpreadsheet(active);
    } else {
      const { data: oneSheet } = await supabase
        .from("project_spreadsheets")
        .select("id, project_id, title, sections, subtotal, total, charges, baked_markups")
        .eq("id", activeSpreadsheetId)
        .eq("project_id", projectId)
        .maybeSingle();
      if (oneSheet) {
        activeSpreadsheet = buildActiveSpreadsheet(oneSheet as ProjectSpreadsheet);
      }
    }
  }

  const { data: quotes } = await supabase
    .from("quotes")
    .select(
      "id, quote_name, quote_number, version_number, status, spreadsheet_id, total_price, scope_of_work, quote_items(id)",
    )
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(MAX_RECENT_QUOTES);

  const recentQuotes: QuoteContextQuoteSummary[] = ((quotes ?? []) as (Quote & {
    quote_items?: Pick<QuoteItem, "id">[];
  })[]).map((q) => {
    const scope = q.scope_of_work?.trim() ?? "";
    return {
      id: q.id,
      quoteName: q.quote_name,
      quoteNumber: q.quote_number,
      versionNumber: q.version_number,
      status: q.status,
      spreadsheetId: q.spreadsheet_id ?? null,
      itemCount: q.quote_items?.length ?? 0,
      totalPrice: Number(q.total_price) || 0,
      scopePreview:
        scope.length > SCOPE_PREVIEW_LEN
          ? `${scope.slice(0, SCOPE_PREVIEW_LEN)}…`
          : scope || null,
    };
  });

  const productFamilies = Array.isArray(project.product_families)
    ? (project.product_families as string[])
    : [];

  const base = {
    projectId: project.id,
    projectName: project.project_name,
    productFamilies,
    activeSpreadsheet,
    spreadsheetSummaries,
    recentQuotes,
    stats: {
      spreadsheetCount: spreadsheetSummaries.length,
      activeLineItemCount: activeSpreadsheet?.lineItems.length ?? 0,
      recentQuoteCount: recentQuotes.length,
    },
  };

  return {
    ...base,
    promptText: buildPromptText(base),
  };
}
