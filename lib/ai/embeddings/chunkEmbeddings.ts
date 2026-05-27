import OpenAI from "openai";

export interface ChunkEmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

class OpenAIChunkEmbeddingProvider implements ChunkEmbeddingProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({
      model: "text-embedding-3-small",
      input: texts,
    });
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

/**
 * Returns an embedding provider when explicitly enabled via env.
 * Default: keyword retrieval only (null).
 */
export function getChunkEmbeddingProvider(): ChunkEmbeddingProvider | null {
  if (process.env.ENABLE_CHUNK_EMBEDDINGS !== "true") return null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAIChunkEmbeddingProvider(apiKey);
}
