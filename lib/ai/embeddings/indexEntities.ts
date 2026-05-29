import type { SupabaseClient } from "@supabase/supabase-js";
import { getChunkEmbeddingProvider } from "@/lib/ai/embeddings/chunkEmbeddings";
import {
  buildMemoryEmbeddingText,
  buildProductEmbeddingText,
} from "@/lib/ai/embeddings/embeddingText";
import type { Product, ProductFamily } from "@/types/database";

const EMBED_BATCH = 64;

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const provider = getChunkEmbeddingProvider();
  if (!provider || texts.length === 0) return null;
  const trimmed = texts.map((t) => t.trim().slice(0, 8000)).filter(Boolean);
  if (trimmed.length === 0) return null;
  return provider.embed(trimmed);
}

export async function indexProductEmbeddings(
  supabase: SupabaseClient,
  organizationId: string,
  options?: { productIds?: string[]; limit?: number },
): Promise<{ indexed: number; skipped: number; errors: number }> {
  let indexed = 0;
  let skipped = 0;
  let errors = 0;

  const familyMap = new Map<string, string>();
  const { data: families } = await supabase
    .from("product_families")
    .select("id, name")
    .eq("organization_id", organizationId);
  for (const f of (families ?? []) as ProductFamily[]) {
    familyMap.set(f.id, f.name);
  }

  let query = supabase
    .from("products")
    .select(
      "id, product_name, product_number, product_brand, product_type, product_family_id, product_tags, description, embedding_text",
    )
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });

  if (options?.productIds?.length) {
    query = query.in("id", options.productIds);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data: products, error } = await query;
  if (error) throw error;
  if (!products?.length) return { indexed, skipped, errors };

  for (let i = 0; i < products.length; i += EMBED_BATCH) {
    const batch = products.slice(i, i + EMBED_BATCH) as (Product & {
      embedding_text?: string | null;
    })[];
    const texts: string[] = [];
    const ids: string[] = [];

    for (const row of batch) {
      const familyName = row.product_family_id
        ? familyMap.get(row.product_family_id) ?? null
        : null;
      const text = buildProductEmbeddingText(row, familyName);
      if (!text.trim()) {
        skipped += 1;
        continue;
      }
      if (row.embedding_text === text) {
        skipped += 1;
        continue;
      }
      texts.push(text);
      ids.push(row.id);
    }

    if (texts.length === 0) continue;

    const embeddings = await embedTexts(texts);
    if (!embeddings) {
      errors += ids.length;
      continue;
    }

    const now = new Date().toISOString();
    for (let j = 0; j < ids.length; j++) {
      const { error: upErr } = await supabase
        .from("products")
        .update({
          embedding: embeddings[j],
          embedding_text: texts[j],
          embedding_indexed_at: now,
        })
        .eq("id", ids[j]);
      if (upErr) errors += 1;
      else indexed += 1;
    }
  }

  return { indexed, skipped, errors };
}

export async function indexMemoryEmbedding(
  supabase: SupabaseClient,
  memoryId: string,
): Promise<boolean> {
  const { data: row, error } = await supabase
    .from("copilot_memories")
    .select("id, title, content, tags")
    .eq("id", memoryId)
    .maybeSingle();

  if (error || !row) return false;

  const text = buildMemoryEmbeddingText(row.title, row.content, row.tags as string[] | null);
  const embeddings = await embedTexts([text]);
  if (!embeddings?.[0]) return false;

  const { error: upErr } = await supabase
    .from("copilot_memories")
    .update({ embedding: embeddings[0], updated_at: new Date().toISOString() })
    .eq("id", memoryId);

  return !upErr;
}
