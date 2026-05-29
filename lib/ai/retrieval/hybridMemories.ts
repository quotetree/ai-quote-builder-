import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery } from "@/lib/ai/embeddings/embedQuery";
import { isHybridRetrievalEnabled } from "@/lib/ai/documentProcessingConfig";
import { tokenizeQuery } from "@/lib/ai/retrieval/scoringUtils";

export interface MemorySearchHit {
  id: string;
  scope: string;
  title: string | null;
  content: string;
  tags: string[] | null;
  projectId: string | null;
  score: number;
}

function keywordMemoryScore(
  row: { title: string | null; content: string; tags: string[] | null },
  terms: string[],
): number {
  if (terms.length === 0) return 0;
  const hay = [row.title, row.content, ...(row.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.reduce((s, t) => (hay.includes(t) ? s + 1 : 0), 0) / terms.length;
}

async function loadMemoryCandidates(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  projectId: string,
): Promise<
  { id: string; scope: string; title: string | null; content: string; tags: string[] | null; project_id: string | null }[]
> {
  const { data: orgRows } = await supabase
    .from("copilot_memories")
    .select("id, scope, title, content, tags, project_id")
    .eq("organization_id", organizationId)
    .eq("is_enabled", true)
    .eq("scope", "organization")
    .order("updated_at", { ascending: false })
    .limit(20);

  const { data: userRows } = await supabase
    .from("copilot_memories")
    .select("id, scope, title, content, tags, project_id")
    .eq("organization_id", organizationId)
    .eq("is_enabled", true)
    .eq("scope", "user")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(15);

  const { data: projectRows } = await supabase
    .from("copilot_memories")
    .select("id, scope, title, content, tags, project_id")
    .eq("organization_id", organizationId)
    .eq("is_enabled", true)
    .eq("scope", "project")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(15);

  type MemoryRow = {
    id: string;
    scope: string;
    title: string | null;
    content: string;
    tags: string[] | null;
    project_id: string | null;
  };

  const byId = new Map<string, MemoryRow>();
  for (const row of [...(orgRows ?? []), ...(userRows ?? []), ...(projectRows ?? [])]) {
    byId.set(row.id as string, row as MemoryRow);
  }
  return Array.from(byId.values());
}

export async function searchMemories(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    userId: string;
    projectId: string;
    query: string;
    maxResults?: number;
  },
): Promise<MemorySearchHit[]> {
  const terms = tokenizeQuery(params.query);
  const maxResults = params.maxResults ?? 8;
  const semanticScores = new Map<string, number>();

  const queryEmbedding =
    isHybridRetrievalEnabled() && params.query.trim()
      ? await embedQuery(params.query)
      : null;

  if (queryEmbedding) {
    const { data: matches } = await supabase.rpc("match_copilot_memories", {
      query_embedding: queryEmbedding,
      match_organization_id: params.organizationId,
      match_user_id: params.userId,
      match_project_id: params.projectId,
      match_count: 20,
      match_threshold: parseFloat(process.env.SEMANTIC_MATCH_THRESHOLD ?? "0.25"),
    });

    for (const m of matches ?? []) {
      semanticScores.set(m.id as string, m.similarity as number);
    }
  }

  const rows = await loadMemoryCandidates(
    supabase,
    params.organizationId,
    params.userId,
    params.projectId,
  );

  if (rows.length === 0) return [];

  const hits: MemorySearchHit[] = [];
  for (const row of rows) {
    const kw = keywordMemoryScore(row, terms);
    const sem = semanticScores.get(row.id) ?? 0;
    const score = queryEmbedding ? 0.6 * sem + 0.4 * kw : kw;
    if (score > 0 || terms.length === 0) {
      hits.push({
        id: row.id,
        scope: row.scope,
        title: row.title,
        content: row.content,
        tags: row.tags,
        projectId: row.project_id,
        score: queryEmbedding ? score : kw || 0.05,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, maxResults);
}
