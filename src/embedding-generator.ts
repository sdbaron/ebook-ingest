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
    sourceFormat: 'epub' | 'pdf' | 'html' | 'url';
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

  constructor(model: string = 'nomic-embed-text') {
    this.model = model;
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
          prompt: chunks[i].slice(0, 8000), // Truncate long texts for embedding
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
