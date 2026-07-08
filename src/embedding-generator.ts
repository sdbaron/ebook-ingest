import ollama from 'ollama';

/**
 * Result of embedding generation for a text chunk.
 */
export interface EmbeddingResult {
  /** The original text chunk */
  text: string;
  /** The embedding vector */
  embedding: number[];
  /** Metadata about this chunk */
  metadata: {
    sourceName: string;
    blockIndex: number;
    sourceFormat: 'epub' | 'pdf' | 'html' | 'url' | 'fb2';
    chapterTitle?: string;
    vaultPath?: string;
  };
}

/**
 * Generate embeddings using Ollama's embedding models.
 *
 * Requires an Ollama embedding model to be pulled, e.g.:
 *   ollama pull nomic-embed-text
 */
export class EmbeddingGenerator {
  private model: string;
  private maxChars: number;

  /**
   * @param model     Ollama embedding model name
   * @param maxChars  Max characters per chunk (default: 4000)
   *                  nomic-embed-text context is 8192 tokens;
   *                  4000 chars ≈ 1000 tokens — safe margin.
   */
  constructor(model: string = 'nomic-embed-text', maxChars: number = 4000) {
    this.model = model;
    this.maxChars = maxChars;
  }

  /**
   * Generate embeddings for multiple text chunks.
   * Processes chunks sequentially to avoid overwhelming Ollama.
   */
  async embed(
    chunks: string[],
    metadatas: EmbeddingResult['metadata'][],
  ): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];

    for (let i = 0; i < chunks.length; i++) {
      try {
        const response = await ollama.embeddings({
          model: this.model,
          prompt: chunks[i].slice(0, this.maxChars), // Truncate to avoid token limit
        });

        results.push({
          text: chunks[i],
          embedding: response.embedding,
          metadata: metadatas[i],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[EMBED] Failed to embed chunk ${i + 1}/${chunks.length}: ${message}`,
        );
        // Continue with remaining chunks
      }
    }

    return results;
  }

  /**
   * Generate a single embedding for a search query.
   */
  async embedQuery(query: string): Promise<number[]> {
    const response = await ollama.embeddings({
      model: this.model,
      prompt: query,
    });
    return response.embedding;
  }

  /**
   * Check if the embedding model is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await ollama.embeddings({
        model: this.model,
        prompt: 'test',
      });
      return true;
    } catch {
      return false;
    }
  }
}
