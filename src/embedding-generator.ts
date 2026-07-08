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
   * @param maxChars  Starting max chars per chunk (default: 8000).
   *                  On context-length errors, automatically reduces
   *                  by 1000 chars and retries, down to 500.
   */
  constructor(model: string = 'nomic-embed-text', maxChars: number = 8000) {
    this.model = model;
    this.maxChars = maxChars;
  }

  /**
   * Generate embeddings for multiple text chunks.
   * Processes chunks sequentially. On token-limit errors, progressively
   * reduces text length until the embedding succeeds or hits minChars.
   */
  async embed(
    chunks: string[],
    metadatas: EmbeddingResult['metadata'][],
  ): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    const MIN_CHARS = 500; // Don't go below this — embedding of <500 chars is meaningless

    for (let i = 0; i < chunks.length; i++) {
      let chars = this.maxChars;
      let embedded = false;

      while (chars >= MIN_CHARS) {
        try {
          const prompt = chunks[i].slice(0, chars);
          const response = await ollama.embeddings({
            model: this.model,
            prompt,
          });

          results.push({
            text: chunks[i],
            embedding: response.embedding,
            metadata: metadatas[i],
          });
          embedded = true;
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const isContextError =
            message.includes('context length') ||
            message.includes('exceeds');

          if (!isContextError || chars <= MIN_CHARS) {
            console.warn(
              `[EMBED] Failed to embed chunk ${i + 1}/${chunks.length}: ${message}`,
            );
            break;
          }

          // Reduce and retry
          chars -= 1000;
          if (chars < MIN_CHARS) chars = MIN_CHARS;
          console.warn(
            `[EMBED] Chunk ${i + 1}/${chunks.length}: context length exceeded, retrying with ${chars} chars`,
          );
        }
      }

      if (!embedded) {
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
