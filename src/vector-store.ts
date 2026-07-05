import { ChromaClient, Collection } from 'chromadb';

/**
 * A document stored in the vector database.
 */
export interface VectorDocument {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    sourceName: string;
    blockIndex: number;
    sourceFormat: string;
    chapterTitle?: string;
    vaultPath: string;
  };
}

/**
 * Client for ChromaDB vector database.
 *
 * Manages a collection of embedded text blocks for semantic search.
 * Gracefully degrades if ChromaDB is not available.
 */
export class VectorStore {
  private client: ChromaClient;
  private collectionName: string;
  private connected: boolean = false;
  private collection: Collection | null = null;

  constructor(
    chromaUrl: string = 'http://localhost:8000',
    collectionName: string = 'ebook_ingest',
  ) {
    this.client = new ChromaClient({ path: chromaUrl });
    this.collectionName = collectionName;
  }

  /**
   * Connect to ChromaDB and get or create the collection.
   */
  async connect(): Promise<void> {
    try {
      await this.client.heartbeat();
      this.collection = await this.client.getOrCreateCollection({
        name: this.collectionName,
        metadata: {
          'hnsw:space': 'cosine',
          description: 'ebook-ingest knowledge base',
        },
      });
      this.connected = true;
      console.log(`[VECTOR] Connected to ChromaDB (collection: ${this.collectionName})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[VECTOR] ChromaDB not available: ${message}`);
      console.warn('[VECTOR] Vector search features disabled. Start ChromaDB to enable.');
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Add or update documents in the vector store.
   */
  async addDocuments(documents: VectorDocument[]): Promise<void> {
    if (!this.connected || !this.collection) return;

    if (documents.length === 0) return;

    await this.collection.upsert({
      ids: documents.map(d => d.id),
      embeddings: documents.map(d => d.embedding),
      documents: documents.map(d => d.text.slice(0, 2000)),
      metadatas: documents.map(d => d.metadata),
    });

    console.log(`[VECTOR] Added ${documents.length} documents`);
  }

  /**
   * Query the vector store for similar documents.
   */
  async query(
    queryEmbedding: number[],
    topK: number = 5,
    filter?: { sourceName?: string; sourceFormat?: string },
  ): Promise<VectorDocument[]> {
    if (!this.connected || !this.collection) return [];

    const where: Record<string, string> = {};
    if (filter?.sourceName) where.sourceName = filter.sourceName;
    if (filter?.sourceFormat) where.sourceFormat = filter.sourceFormat;

    const results = await this.collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      where: Object.keys(where).length > 0 ? where : undefined,
    });

    const documents: VectorDocument[] = [];
    const ids = results.ids?.[0] || [];
    const distances = results.distances?.[0] || [];
    const docs = results.documents?.[0] || [];
    const metadatas = results.metadatas?.[0] || [];

    for (let i = 0; i < ids.length; i++) {
      const docText = docs[i];
      if (!docText) continue;
      documents.push({
        id: ids[i],
        text: docText,
        embedding: [],
        metadata: (metadatas[i] || {}) as VectorDocument['metadata'],
      });
    }

    return documents;
  }

  /**
   * Delete all documents for a specific source.
   */
  async deleteSource(sourceName: string): Promise<void> {
    if (!this.connected || !this.collection) return;

    const results = await this.collection.get({
      where: { sourceName },
    });

    const ids = results.ids || [];
    if (ids.length > 0) {
      await this.collection.delete({ ids });
      console.log(`[VECTOR] Deleted ${ids.length} documents for source "${sourceName}"`);
    }
  }

  /**
   * Get total document count.
   */
  async count(): Promise<number> {
    if (!this.connected || !this.collection) return 0;

    const results = await this.collection.get();
    return (results.ids || []).length;
  }
}

/**
 * Build a deterministic document ID from source name and block index.
 */
export function buildDocId(sourceName: string, blockIndex: number): string {
  return `${sourceName}__block_${String(blockIndex).padStart(3, '0')}`;
}
