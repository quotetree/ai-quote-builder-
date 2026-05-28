import OpenAI from "openai";
import { getChunkEmbeddingProvider } from "@/lib/ai/embeddings/chunkEmbeddings";

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (!cachedClient) cachedClient = new OpenAI({ apiKey: key });
  return cachedClient;
}

/**
 * Embed a user query for semantic chunk retrieval.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  if (process.env.ENABLE_CHUNK_EMBEDDINGS !== "true") return null;

  const provider = getChunkEmbeddingProvider();
  if (!provider) return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const [embedding] = await provider.embed([trimmed.slice(0, 8000)]);
    return embedding ?? null;
  } catch {
    return null;
  }
}
