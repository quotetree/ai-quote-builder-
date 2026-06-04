import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemplatePage } from "@/components/proposal-template/proposalTemplateTypes";
import type { QuoteWithProfile } from "@/components/proposal-template/QuoteBlock";

/** Collects embedded quote IDs from quote-type elements across all pages. */
export function collectEmbeddedQuoteIds(pages: TemplatePage[]): Set<string> {
  const ids = new Set<string>();
  for (const page of pages) {
    for (const el of page.elements) {
      if (el.type === "quote" && el.content) {
        try {
          const parsed = JSON.parse(el.content);
          if (parsed.quoteId) ids.add(parsed.quoteId);
        } catch {
          // malformed content — skip
        }
      }
    }
  }
  return ids;
}

/** Loads quote + org profile data for embedded quote elements (server-side). */
export async function fetchEmbeddedQuoteData(
  admin: SupabaseClient,
  pages: TemplatePage[]
): Promise<Record<string, QuoteWithProfile>> {
  const embeddedQuoteIds = collectEmbeddedQuoteIds(pages);
  const quoteDataMap: Record<string, QuoteWithProfile> = {};

  if (embeddedQuoteIds.size === 0) return quoteDataMap;

  await Promise.all(
    Array.from(embeddedQuoteIds).map(async (qId) => {
      try {
        const { data: quoteData } = await admin
          .from("quotes")
          .select("*, items:quote_items(*)")
          .eq("id", qId)
          .single();

        if (!quoteData) return;

        const { data: org } = await admin
          .from("organizations")
          .select("owner_id")
          .eq("id", quoteData.organization_id)
          .single();

        let profile = null;
        if (org?.owner_id) {
          const { data: p } = await admin
            .from("profiles")
            .select("company_name, company_address, company_logo_url")
            .eq("id", org.owner_id)
            .single();
          profile = p ?? null;
        }

        quoteDataMap[qId] = { quote: quoteData, profile };
      } catch {
        // non-fatal — quote block will be omitted from export HTML
      }
    })
  );

  return quoteDataMap;
}
