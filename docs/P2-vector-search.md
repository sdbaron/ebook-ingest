<!-- markdownlint-disable MD024 -->

# P2 – Vektorsuche + Embeddings

> **Ziel:** Kapitel-Blöcke als Embeddings in einer lokalen Vektordatenbank (ChromaDB) speichern
> und semantische Suche über den gesamten Vault ermöglichen — ohne Obsidian öffnen zu müssen.

---

## Übersicht der Teilaufgaben

| # | Aufgabe | Geschätzte Zeit |
| --- | --- | --- |
| 1 | Abhängigkeiten installieren | 15 min |
| 2 | Embedding-Generator (Ollama-Embeddings) bauen | 1 h |
| 3 | ChromaDB-Client einrichten | 1 h |
| 4 | `VectorStore`-Klasse implementieren | 1,5 h |
| 5 | Embeddings während der Ingestion generieren und speichern | 1 h |
| 6 | `--reindex`-Befehl für bestehende Vaults | 45 min |
| 7 | Semantische Such-Funktion | 1 h |
| 8 | CLI-Befehl `search` bauen | 1 h |
| 9 | Unit-Tests schreiben | 1,5 h |

Gesamt: ~9 Stunden

---

## Voraussetzungen

### ChromaDB

ChromaDB muss lokal laufen. Empfohlene Installation:

```bash
# Via Docker (empfohlen)
docker run -d -p 8000:8000 \
  -v ~/chromadb-data:/chroma/chroma \
  -e IS_PERSISTENT=TRUE \
  chromadb/chroma

# Oder via pip (Python-Abhängigkeit)
pip install chromadb
chroma run --path ./chromadb-data
```

### Ollama Embedding-Modell

```bash
ollama pull nomic-embed-text
# oder
ollama pull mxbai-embed-large
```

---

## Aufgabe 1: Abhängigkeiten installieren

**Datei:** `package.json`

```bash
pnpm add chromadb chromadb-default-embed
```

- `chromadb`: Offizieller JS-Client für ChromaDB
- `chromadb-default-embed`: Optionaler Fallback-Embedder (wenn Ollama nicht verfügbar)

**Hinweis:** `chromadb` benötigt Node ≥ 18.

### Akzeptanzkriterien

- [ ] `pnpm install` läuft ohne Fehler
- [ ] `import { ChromaClient } from 'chromadb'` funktioniert

---

## Aufgabe 2: Embedding-Generator (Ollama) bauen

**Neue Datei:** `src/embedding-generator.ts`

### Schnittstelle

```typescript
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
  };
}

export class EmbeddingGenerator {
  private model: string;

  constructor(model?: string); // Default: 'nomic-embed-text'

  /**
   * Generate embeddings for multiple text chunks.
   */
  async embed(
    chunks: string[],
    metadata: EmbeddingResult['metadata'][],
  ): Promise<EmbeddingResult[]>;

  /**
   * Generate a single embedding (for search queries).
   */
  async embedQuery(query: string): Promise<number[]>;
}
```

### Implementierung mit Ollama

```typescript
import ollama from 'ollama';

export class EmbeddingGenerator {
  private model: string;

  constructor(model = 'nomic-embed-text') {
    this.model = model;
  }

  async embed(
    chunks: string[],
    metadatas: EmbeddingResult['metadata'][],
  ): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const response = await ollama.embeddings({
        model: this.model,
        prompt: chunks[i],
      });

      results.push({
        text: chunks[i],
        embedding: response.embedding,
        metadata: metadatas[i],
      });
    }

    return results;
  }

  async embedQuery(query: string): Promise<number[]> {
    const response = await ollama.embeddings({
      model: this.model,
      prompt: query,
    });
    return response.embedding;
  }
}
```

### Performance-Hinweis

- Embedding-Generierung ist langsam (1-2 Sekunden pro Chunk bei lokaler Ollama).
- Für Bücher mit 50+ Kapiteln: Batch-Processing mit Fortschrittsanzeige.
- Später optional: Parallele Requests (2-3 gleichzeitig).

### Akzeptanzkriterien

- [ ] `embed()` generiert Embeddings für mehrere Chunks
- [ ] `embedQuery()` generiert ein einzelnes Embedding
- [ ] Metadaten werden korrekt zugewiesen
- [ ] Fehler bei Ollama-Unverfügbarkeit werden sauber behandelt

---

## Aufgabe 3: ChromaDB-Client einrichten

**Neue Datei:** `src/vector-store.ts` (Teil 1)

### Verbindungsaufbau

```typescript
import { ChromaClient } from 'chromadb';

export class VectorStore {
  private client: ChromaClient;
  private collectionName: string;
  private connected: boolean = false;

  constructor(
    private chromaUrl: string = 'http://localhost:8000',
    collectionName: string = 'ebook_ingest',
  ) {
    this.client = new ChromaClient({ path: chromaUrl });
    this.collectionName = collectionName;
  }

  async connect(): Promise<void> {
    try {
      // Heartbeat-Check
      await this.client.heartbeat();
      this.connected = true;
      console.log(`[VECTOR] Connected to ChromaDB at ${this.chromaUrl}`);
    } catch (err) {
      console.warn(`[VECTOR] ChromaDB not available at ${this.chromaUrl}. Vector features disabled.`);
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
```

### Collection-Management

```typescript
async getOrCreateCollection() {
  if (!this.connected) return null;

  try {
    return await this.client.getCollection({ name: this.collectionName });
  } catch {
    return await this.client.createCollection({
      name: this.collectionName,
      metadata: {
        'hnsw:space': 'cosine',
        description: 'ebook-ingest knowledge base',
      },
    });
  }
}
```

### Akzeptanzkriterien

- [ ] Verbindung zu ChromaDB wird hergestellt
- [ ] Collection wird erstellt, wenn nicht vorhanden
- [ ] Wenn ChromaDB nicht läuft: keine Crashs, nur Warnung
- [ ] `isConnected()` gibt korrekten Status zurück

---

## Aufgabe 4: `VectorStore`-Klasse vervollständigen

**Datei:** `src/vector-store.ts` (Teil 2)

### Speicher-Methoden

```typescript
export interface VectorDocument {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    sourceName: string;
    blockIndex: number;
    sourceFormat: string;
    chapterTitle?: string;
    vaultPath: string;  // Pfad zur .md-Datei im Vault
  };
}

export class VectorStore {
  // ...previous code...

  /**
   * Add documents to the vector store.
   * Uses upsert to avoid duplicates.
   */
  async addDocuments(documents: VectorDocument[]): Promise<void>;

  /**
   * Query the vector store for similar documents.
   */
  async query(
    queryEmbedding: number[],
    topK: number,
    filter?: { sourceName?: string; sourceFormat?: string },
  ): Promise<VectorDocument[]>;

  /**
   * Delete all documents for a specific source.
   */
  async deleteSource(sourceName: string): Promise<void>;

  /**
   * Get document count.
   */
  async count(): Promise<number>;
}
```

### Implementierung `addDocuments`

```typescript
async addDocuments(documents: VectorDocument[]): Promise<void> {
  if (!this.connected) return;

  const collection = await this.getOrCreateCollection();
  if (!collection) return;

  await collection.upsert({
    ids: documents.map(d => d.id),
    embeddings: documents.map(d => d.embedding),
    documents: documents.map(d => d.text.slice(0, 2000)), // Truncate für ChromaDB
    metadatas: documents.map(d => d.metadata),
  });

  console.log(`[VECTOR] Added ${documents.length} documents to ChromaDB`);
}
```

### ID-Schema

```typescript
function buildDocId(sourceName: string, blockIndex: number): string {
  return `${sourceName}__block_${String(blockIndex).padStart(3, '0')}`;
}
```

### Akzeptanzkriterien

- [ ] Dokumente werden in ChromaDB gespeichert
- [ ] Upsert verhindert Duplikate
- [ ] `query()` gibt relevante Dokumente zurück
- [ ] `deleteSource()` entfernt alle Dokumente einer Quelle
- [ ] `count()` gibt korrekte Anzahl zurück

---

## Aufgabe 5: Embeddings während der Ingestion generieren

**Datei:** `src/pipeline.ts` (erweitern)

### Integration in `WikiPipeline`

Nach der LLM-Analyse und dem Schreiben der Markdown-Dateien:

```typescript
async ingest(
  sourcePath: string,
  sourceName: string,
  project: string = 'General',
  options?: { skipVectors?: boolean },
): Promise<void> {
  // ...existing extraction + analysis code...

  // Generate embeddings (if ChromaDB is available)
  if (!options?.skipVectors && this.vectorStore?.isConnected()) {
    console.log(`[VECTOR] Generating embeddings for ${sourceName}...`);

    const embedResults = await this.embeddingGenerator.embed(
      chapters,  // Original chapter texts
      chapters.map((_, i) => ({
        sourceName,
        blockIndex: i + 1,
        sourceFormat: extractionResult.format,
        vaultPath: `${sourceName}/${String(i + 1).padStart(2, '0')}.md`,
      })),
    );

    await this.vectorStore.addDocuments(
      embedResults.map(r => ({
        id: buildDocId(sourceName, r.metadata.blockIndex),
        text: r.text,
        embedding: r.embedding,
        metadata: {
          ...r.metadata,
          vaultPath: r.metadata.vaultPath,
        },
      })),
    );
  }
}
```

### CLI-Flag

```bash
ebook-ingest file.epub "My Book" --skip-vectors
```

### Akzeptanzkriterien

- [ ] Embeddings werden nach der LLM-Analyse generiert
- [ ] Embeddings werden in ChromaDB gespeichert
- [ ] `--skip-vectors` überspringt die Vektorisierung
- [ ] Wenn ChromaDB nicht läuft: kein Fehler, nur Log-Warnung

---

## Aufgabe 6: `--reindex`-Befehl für bestehende Vaults

### CLI

```bash
ebook-ingest reindex [--vault <path>] [--source <name>]
```

- Ohne `--source`: Alle Quellen im Vault neu indexieren.
- Mit `--source`: Nur eine bestimmte Quelle.

### Implementierung

```typescript
async reindex(config: EbookIngestConfig, sourceName?: string): Promise<void> {
  const sourcesDir = path.resolve(config.vault, config.sourcesDir);
  
  // Finde alle Quellen oder eine spezifische
  const sources = sourceName 
    ? [sourceName]
    : await fs.readdir(sourcesDir);

  for (const source of sources) {
    const sourceDir = path.resolve(sourcesDir, source);
    const stat = await fs.stat(sourceDir);
    if (!stat.isDirectory()) continue;

    console.log(`[REINDEX] Processing ${source}...`);
    
    // Lese alle .md-Blöcke
    const files = (await fs.readdir(sourceDir))
      .filter(f => f.match(/^\d+\.md$/))
      .sort();

    for (const file of files) {
      const content = await fs.readFile(path.resolve(sourceDir, file), 'utf-8');
      // Extrahiere Text aus Markdown (ohne Frontmatter)
      const text = this.extractTextFromMarkdown(content);
      
      // Generiere Embedding
      const embedding = await this.embeddingGenerator.embedQuery(text);
      
      // Speichere in ChromaDB
      await this.vectorStore.addDocuments([{
        id: buildDocId(source, parseInt(file)),
        text,
        embedding,
        metadata: {
          sourceName: source,
          blockIndex: parseInt(file),
          sourceFormat: 'epub', // Aus Frontmatter lesen
          vaultPath: `${source}/${file}`,
        },
      }]);
    }
  }
}
```

### Akzeptanzkriterien

- [ ] `reindex` verarbeitet alle Quellen im Vault
- [ ] `--source` beschränkt auf eine Quelle
- [ ] Bestehende Embeddings werden überschrieben (upsert)
- [ ] Fortschrittsanzeige bei vielen Quellen

---

## Aufgabe 7: Semantische Such-Funktion

### `VectorStore.query()` Implementierung

```typescript
async query(
  queryEmbedding: number[],
  topK: number = 5,
  filter?: { sourceName?: string; sourceFormat?: string },
): Promise<VectorDocument[]> {
  if (!this.connected) {
    console.warn('[VECTOR] ChromaDB not connected. Search unavailable.');
    return [];
  }

  const collection = await this.getOrCreateCollection();
  if (!collection) return [];

  const whereFilter: Record<string, unknown> = {};
  if (filter?.sourceName) whereFilter.sourceName = filter.sourceName;
  if (filter?.sourceFormat) whereFilter.sourceFormat = filter.sourceFormat;

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: topK,
    where: Object.keys(whereFilter).length > 0 ? whereFilter : undefined,
  });

  return this.parseQueryResults(results);
}
```

### Such-Funktion (High-Level)

```typescript
export interface SearchResult {
  text: string;
  score: number;       // 0–1 (1 = perfekte Übereinstimmung)
  sourceName: string;
  blockIndex: number;
  vaultPath: string;
  sourceFormat: string;
}

export class KnowledgeSearch {
  constructor(
    private vectorStore: VectorStore,
    private embeddingGenerator: EmbeddingGenerator,
  );

  async search(
    query: string,
    topK?: number,
    filter?: { sourceName?: string; sourceFormat?: string },
  ): Promise<SearchResult[]>;
}
```

### Akzeptanzkriterien

- [ ] `search()` gibt semantisch relevante Ergebnisse zurück
- [ ] `topK` begrenzt die Anzahl der Ergebnisse
- [ ] `filter` schränkt auf bestimmte Quellen ein
- [ ] Score wird korrekt berechnet (Cosine-Similarity → 0–1)
- [ ] Leeres Ergebnis bei ChromaDB-Unverfügbarkeit

---

## Aufgabe 8: CLI-Befehl `search` bauen

**Datei:** `src/cli.ts` (erweitern)

```bash
ebook-ingest search "What is dependency inversion?" [--top 5] [--source "Clean_Architecture"]
```

### Ausgabeformat

```text
🔍 Search: "What is dependency inversion?"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] Score: 0.92 | Clean_Architecture / 03.md
    The Dependency Inversion Principle (DIP) states that
    high-level modules should not depend on low-level modules.
    Both should depend on abstractions...
    ───────────────────────────────────────────────────────

[2] Score: 0.87 | Clean_Architecture / 07.md
    ...abstractions should not depend on details. Details
    should depend on abstractions. This is the core of
    the Dependency Inversion Principle...
    ───────────────────────────────────────────────────────

[3] Score: 0.81 | Clean_Code / 05.md
    ...inversion of control is a key pattern that enables
    loose coupling between components...
```

### Implementation

```typescript
// In cli.ts
if (command === 'search') {
  const query = args[1];
  let topK = 5;
  let sourceFilter: string | undefined;

  // Parse flags
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--top' && i + 1 < args.length) {
      topK = parseInt(args[++i]);
    } else if (args[i] === '--source' && i + 1 < args.length) {
      sourceFilter = args[++i];
    }
  }

  const search = new KnowledgeSearch(vectorStore, embeddingGenerator);
  const results = await search.search(query, topK, sourceFilter ? { sourceName: sourceFilter } : undefined);

  // Format output
  console.log(`\n🔍 Search: "${query}"`);
  console.log('━'.repeat(60) + '\n');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`[${i + 1}] Score: ${r.score.toFixed(2)} | ${r.sourceName} / ${String(r.blockIndex).padStart(2, '0')}.md`);
    console.log(`    ${r.text.slice(0, 200).replace(/\n/g, ' ')}...`);
    console.log('    ' + '─'.repeat(50));
  }
}
```

### Akzeptanzkriterien

- [ ] `search` gibt formatierte Ergebnisse aus
- [ ] `--top` begrenzt die Ergebnisse
- [ ] `--source` filtert nach Quelle
- [ ] Ohne ChromaDB: verständliche Fehlermeldung

---

## Aufgabe 9: Unit-Tests schreiben

### Neue Dateien

- `tests/embedding-generator.test.ts`
- `tests/vector-store.test.ts`

### embedding-generator.test.ts

- [ ] `embed()` gibt korrekte Anzahl Embeddings zurück
- [ ] `embedQuery()` gibt einen Vektor zurück
- [ ] Embedding-Dimension ist konsistent (z. B. 768 für nomic-embed-text)
- [ ] Fehler bei Ollama-Unverfügbarkeit wird behandelt

### vector-store.test.ts

- [ ] `connect()` zu laufender ChromaDB
- [ ] `connect()` zu nicht-laufender ChromaDB (graceful degradation)
- [ ] `addDocuments()` speichert korrekt
- [ ] `query()` findet relevante Dokumente
- [ ] `deleteSource()` entfernt korrekt
- [ ] `count()` gibt korrekte Anzahl

### Hinweise zum Testing

- ChromaDB-Tests benötigen eine laufende Instanz. In CI: entweder ChromaDB via Docker starten oder die Tests skippen.
- Ollama-Tests: Mocken, um deterministische Tests zu haben.

```typescript
// In jest.config.ts: Tests die ChromaDB benötigen, können mit einem Tag markiert werden
// und in CI übersprungen werden:
test('query finds documents', async () => {
  if (!process.env.CHROMA_URL) {
    console.log('Skipping ChromaDB test (no CHROMA_URL)');
    return;
  }
  // ...test...
});
```

---

## Zusammenfassung der neuen/geänderten Dateien

| Datei | Aktion |
| --- | --- |
| `src/embedding-generator.ts` | **Neu** |
| `src/vector-store.ts` | **Neu** |
| `src/knowledge-search.ts` | **Neu** |
| `src/pipeline.ts` | Ändern (Embeddings nach LLM-Analyse) |
| `src/cli.ts` | Ändern (search + reindex Befehle) |
| `src/config.ts` | Ändern (chromaUrl, embeddingModel) |
| `src/index.ts` | Ändern (neue Exports) |
| `package.json` | Ändern (chromadb Dependency) |
| `tests/embedding-generator.test.ts` | **Neu** |
| `tests/vector-store.test.ts` | **Neu** |
