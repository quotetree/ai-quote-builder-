import type { SupabaseClient } from "@supabase/supabase-js";
import type { Quote, QuoteItem, ProjectSpreadsheet } from "@/types/database";
import { embedQuery } from "@/lib/ai/embeddings/embedQuery";
import { embedTexts } from "@/lib/ai/embeddings/indexEntities";
import { isHybridRetrievalEnabled } from "@/lib/ai/documentProcessingConfig";
import { tokenizeQuery } from "@/lib/ai/retrieval/scoringUtils";

export interface PriorProjectHit {
  projectId: string;
  projectName: string;
  profileText: string;
  metadata: Record<string, unknown>;
  score: number;
}

const PROFILE_PREVIEW = 1200;

function buildProfileText(
  projectName: string,
  quotes: (Quote & { quote_items?: QuoteItem[] })[],
  spreadsheets: Pick<ProjectSpreadsheet, "title" | "total" | "sections">[],
): string {
  const lines: string[] = [`Project: ${projectName}`];

  for (const q of quotes.slice(0, 5)) {
    lines.push(
      `Quote: ${q.quote_name} v${q.version_number} — ${q.status} — total ${q.total_price}`,
    );
    if (q.scope_of_work?.trim()) {
      lines.push(`Scope: ${q.scope_of_work.trim().slice(0, 800)}`);
    }
    const items = q.quote_items ?? [];
    const productNames = items
      .map((i) => i.product_name)
      .filter(Boolean)
      .slice(0, 40);
    if (productNames.length) {
      lines.push(`Products: ${productNames.join(", ")}`);
    }
  }

  for (const s of spreadsheets.slice(0, 3)) {
    lines.push(`Spreadsheet: ${s.title} — total ${s.total}`);
  }

  return lines.join("\n").slice(0, 12_000);
}

export async function upsertProjectRetrievalProfile(
  supabase: SupabaseClient,
  organizationId: string,
  projectId: string,
): Promise<void> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, project_name")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return;

  const [{ data: quotes }, { data: sheets }] = await Promise.all([
    supabase
      .from("quotes")
      .select("id, quote_name, version_number, status, total_price, scope_of_work, quote_items(product_name)")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("project_spreadsheets")
      .select("title, total, sections")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(3),
  ]);

  const profileText = buildProfileText(
    project.project_name,
    (quotes ?? []) as (Quote & { quote_items?: QuoteItem[] })[],
    (sheets ?? []) as ProjectSpreadsheet[],
  );

  const metadata = {
    quote_count: quotes?.length ?? 0,
    spreadsheet_count: sheets?.length ?? 0,
    last_quote_total: quotes?.[0]?.total_price ?? null,
  };

  const embeddings = await embedTexts([profileText]);
  const now = new Date().toISOString();

  await supabase.from("project_retrieval_profiles").upsert(
    {
      organization_id: organizationId,
      project_id: projectId,
      project_name: project.project_name,
      profile_text: profileText,
      metadata,
      embedding: embeddings?.[0] ?? null,
      indexed_at: now,
      updated_at: now,
    },
    { onConflict: "project_id" },
  );
}

export async function searchPriorProjects(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    excludeProjectId: string;
    query: string;
    maxResults?: number;
  },
): Promise<PriorProjectHit[]> {
  const maxResults = params.maxResults ?? 5;
  const terms = tokenizeQuery(params.query);

  const queryEmbedding =
    isHybridRetrievalEnabled() && terms.length > 0
      ? await embedQuery(params.query)
      : null;

  if (queryEmbedding) {
    const { data: matches } = await supabase.rpc("match_project_retrieval_profiles", {
      query_embedding: queryEmbedding,
      match_organization_id: params.organizationId,
      exclude_project_id: params.excludeProjectId,
      match_count: maxResults,
      match_threshold: parseFloat(process.env.SEMANTIC_MATCH_THRESHOLD ?? "0.22"),
    });

    return (matches ?? []).map((m: {
      project_id: string;
      project_name: string;
      profile_text: string;
      metadata: Record<string, unknown>;
      similarity: number;
    }) => ({
      projectId: m.project_id as string,
      projectName: m.project_name as string,
      profileText: (m.profile_text as string).slice(0, PROFILE_PREVIEW),
      metadata: (m.metadata as Record<string, unknown>) ?? {},
      score: m.similarity as number,
    }));
  }

  const { data: profiles } = await supabase
    .from("project_retrieval_profiles")
    .select("project_id, project_name, profile_text, metadata")
    .eq("organization_id", params.organizationId)
    .neq("project_id", params.excludeProjectId)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (!profiles?.length) return [];

  const hits: PriorProjectHit[] = [];
  for (const p of profiles) {
    const hay = `${p.project_name} ${p.profile_text}`.toLowerCase();
    const kw =
      terms.length === 0
        ? 0.1
        : terms.reduce((s, t) => (hay.includes(t) ? s + 1 : 0), 0) / terms.length;
    if (kw > 0) {
      hits.push({
        projectId: p.project_id as string,
        projectName: p.project_name as string,
        profileText: (p.profile_text as string).slice(0, PROFILE_PREVIEW),
        metadata: (p.metadata as Record<string, unknown>) ?? {},
        score: kw,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, maxResults);
}
