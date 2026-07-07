<!-- markdownlint-disable MD024 -->

# P2 – Chat-Interface ("Ask my Vault")

> **Ziel:** Ein CLI-Chat-Interface, das Fragen auf Basis des gesamten Vault-Inhalts beantwortet.
> Kombiniert Vektorsuche (ChromaDB) mit Ollama LLM für kontextbezogene Antworten — ein
> lokales RAG-System (Retrieval-Augmented Generation) ohne Cloud-Abhängigkeit.

---

## Übersicht der Teilaufgaben

| # | Aufgabe | Geschätzte Zeit |
| --- | --- | --- |
| 1 | `ChatEngine`-Klasse entwerfen | 1 h |
| 2 | RAG-Pipeline implementieren (Retrieve → Augment → Generate) | 2 h |
| 3 | Prompt-Template-System bauen | 1 h |
| 4 | Konversationsverlauf (Chat History) | 1 h |
| 5 | CLI-Chat-Modus (`ask` Befehl) | 1,5 h |
| 6 | Zitieren von Quellen in Antworten | 1 h |
| 7 | Streaming-Antworten | 1 h |
| 8 | Unit-Tests schreiben | 1 h |

Gesamt: ~9,5 Stunden

---

## Konzept

### RAG-Pipeline

```text
User: "Was ist Dependency Inversion?"
         ↓
   [1] RETRIEVE: Vektorsuche in ChromaDB
         → Finde die 5 relevantesten Textblöcke
         ↓
   [2] AUGMENT: Baue einen Prompt mit Kontext
         → "Beantworte die Frage. Nutze diese Quellen: [gefundene Blöcke]"
         ↓
   [3] GENERATE: Ollama LLM generiert Antwort
         → "Dependency Inversion (DIP) ist ein Prinzip, das besagt..."
         ↓
   [4] SOURCE: Zitiere die verwendeten Quellen
         → "Quellen: Clean_Architecture/03.md, Clean_Code/05.md"
```

### Architektur

```text
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  ChatEngine  │───▶│  VektorStore │───▶│   ChromaDB   │
│              │    │  (P2)        │    │              │
│              │    └──────────────┘    └──────────────┘
│              │    ┌──────────────┐
│              │───▶│  Ollama LLM  │
│              │    │  (bestehend) │
│              │    └──────────────┘
└──────────────┘
```

---

## Aufgabe 1: `ChatEngine`-Klasse entwerfen

**Neue Datei:** `src/chat-engine.ts`

### Schnittstelle

```typescript
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface SourceCitation {
  sourceName: string;
  blockIndex: number;
  vaultPath: string;
  excerpt: string;      // Relevanter Textausschnitt
  relevanceScore: number;
}

export interface ChatResponse {
  answer: string;
  sources: SourceCitation[];
  /** The raw LLM response for debugging */
  rawPrompt?: string;
}

export class ChatEngine {
  constructor(
    private vectorStore: VectorStore,
    private embeddingGenerator: EmbeddingGenerator,
    private llmModel: string,
  );

  /**
   * Answer a question using RAG.
   * @param question   The user's question
   * @param history    Previous conversation messages (for context)
   * @param topK       Number of documents to retrieve
   */
  async ask(
    question: string,
    history?: ChatMessage[],
    topK?: number,
  ): Promise<ChatResponse>;

  /**
   * Start an interactive chat session (reads from stdin).
   */
  async chat(options?: { topK?: number; showSources?: boolean }): Promise<void>;
}
```

### Akzeptanzkriterien
- [ ] `ask()` gibt eine Antwort mit Quellenangaben zurück
- [ ] `chat()` startet eine interaktive Session
- [ ] Ohne ChromaDB: Fallback auf reines LLM (ohne Kontext)

---

## Aufgabe 2: RAG-Pipeline implementieren

### Schritt 1: Retrieve

```typescript
private async retrieve(
  question: string,
  topK: number,
): Promise<VectorDocument[]> {
  const queryEmbedding = await this.embeddingGenerator.embedQuery(question);
  return this.vectorStore.query(queryEmbedding, topK);
}
```

### Schritt 2: Augment (Prompt bauen)

```typescript
private buildAugmentedPrompt(
  question: string,
  documents: VectorDocument[],
  history?: ChatMessage[],
): string {
  // Kontext aus gefundenen Dokumenten
  const contextParts = documents.map((doc, i) => {
    return `[Quelle ${i + 1}: ${doc.metadata.sourceName}, Abschnitt ${doc.metadata.blockIndex}]
${doc.text.slice(0, 1000)}`;
  });

  const context = contextParts.join('\n\n');

  // Optional: Chat History
  const historyText = history
    ? history.map(m => `${m.role}: ${m.content}`).join('\n')
    : '';

  return `Du bist ein Wissens-Assistent mit Zugriff auf eine persönliche Wissensdatenbank.
Beantworte die Frage des Benutzers NUR auf Basis der folgenden Quellen.
Wenn die Quellen die Frage nicht beantworten können, sage ehrlich "Das kann ich aus meinen Quellen nicht beantworten."
Zitiere die Quellen-Nummern in deiner Antwort, z.B. [1], [2].

${historyText ? `Bisherige Konversation:\n${historyText}\n\n` : ''}

=== QUELLEN ===
${context}

=== FRAGE ===
${question}

=== ANTWORT (mit Quellenangaben [1], [2], ...) ===`;
}
```

### Schritt 3: Generate

```typescript
private async generate(prompt: string): Promise<string> {
  const response = await ollama.chat({
    model: this.llmModel,
    messages: [{ role: 'user', content: prompt }],
    options: {
      temperature: 0.3,  // Niedrigere Temperatur für faktische Antworten
      num_predict: 1024,
    },
  });

  return response.message.content;
}
```

### Zusammenführung in `ask()`

```typescript
async ask(
  question: string,
  history?: ChatMessage[],
  topK: number = 5,
): Promise<ChatResponse> {
  // 1. Retrieve
  const documents = await this.retrieve(question, topK);

  if (documents.length === 0) {
    return {
      answer: 'Keine relevanten Quellen gefunden. Bitte stelle eine andere Frage oder indexiere mehr Dokumente.',
      sources: [],
    };
  }

  // 2. Augment
  const prompt = this.buildAugmentedPrompt(question, documents, history);

  // 3. Generate
  const answer = await this.generate(prompt);

  // 4. Build source citations
  const sources: SourceCitation[] = documents.map(doc => ({
    sourceName: doc.metadata.sourceName,
    blockIndex: doc.metadata.blockIndex,
    vaultPath: doc.metadata.vaultPath,
    excerpt: doc.text.slice(0, 300),
    relevanceScore: 0, // ChromaDB gibt standardmäßig Distanz zurück
  }));

  return {
    answer,
    sources,
    rawPrompt: prompt,
  };
}
```

### Akzeptanzkriterien
- [ ] Retrieve findet relevante Dokumente
- [ ] Prompt enthält Kontext und Frage
- [ ] Antwort zitiert Quellen mit [1], [2]
- [ ] Ohne relevante Quellen: ehrliche Antwort
- [ ] Fallback auf reines LLM, wenn kein ChromaDB

---

## Aufgabe 3: Prompt-Template-System bauen

**Neue Datei:** `src/prompt-templates.ts`

### Konzept

Prompt-Templates sind konfigurierbare Vorlagen für verschiedene Antwort-Stile:

```typescript
export interface PromptTemplate {
  name: string;
  systemPrompt: string;
  contextWrapper: (sources: string) => string;
  questionWrapper: (question: string) => string;
}

export const promptTemplates: Record<string, PromptTemplate> = {
  default: {
    name: 'Standard (faktisch)',
    systemPrompt: `Du bist ein Wissens-Assistent. Beantworte Fragen NUR auf Basis der Quellen.
Wenn die Quellen nicht ausreichen, sage es ehrlich. Zitiere mit [1], [2].`,
    contextWrapper: (sources) => `=== QUELLEN ===\n${sources}`,
    questionWrapper: (q) => `=== FRAGE ===\n${q}\n\n=== ANTWORT ===`,
  },

  academic: {
    name: 'Akademisch (ausführlich)',
    systemPrompt: `Du bist ein akademischer Forschungs-Assistent.
Beantworte Fragen ausführlich, mit präzisen Quellenangaben.
Strukturiere deine Antwort in: Zusammenfassung, Details, Quellen.`,
    contextWrapper: (sources) => `=== FORSCHUNGSMATERIAL ===\n${sources}`,
    questionWrapper: (q) => `=== FORSCHUNGSFRAGE ===\n${q}\n\n=== AUSFÜHRLICHE ANTWORT ===`,
  },

  concise: {
    name: 'Kurz (bullet points)',
    systemPrompt: `Du bist ein prägnanter Wissens-Assistent.
Antworte in 3-5 Bullet Points. Zitiere mit [1], [2].`,
    contextWrapper: (sources) => `Quellen:\n${sources}`,
    questionWrapper: (q) => `Frage: ${q}\n\nAntwort (Bullet Points):`,
  },
};
```

### Integration in ChatEngine

```typescript
class ChatEngine {
  constructor(
    // ...
    private template: PromptTemplate = promptTemplates.default,
  ) {}

  // Im CLI: --style academic | concise | default
}
```

### Akzeptanzkriterien
- [ ] 3 Prompt-Templates sind definiert
- [ ] Template kann per CLI-Option gewählt werden
- [ ] Eigenes Template als JSON-Datei ladbar
- [ ] Templates beeinflussen den Antwort-Stil

---

## Aufgabe 4: Konversationsverlauf (Chat History)

### Konzept

Der Chat-Modus speichert den Verlauf im Speicher (nicht persistent). Bei jedem neuen
`ask()`-Aufruf wird der Verlauf in den Prompt eingebaut, sodass das LLM auf vorherige
Fragen Bezug nehmen kann.

```typescript
export class ChatSession {
  private messages: ChatMessage[] = [];
  private maxHistory: number;

  constructor(maxHistory: number = 10) {
    this.maxHistory = maxHistory;
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content });
    this.trimHistory();
  }

  addAssistantMessage(content: string): void {
    this.messages.push({ role: 'assistant', content });
    this.trimHistory();
  }

  getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  private trimHistory(): void {
    // Behalte nur die letzten N Nachrichten (User + Assistant = 2 * maxHistory)
    const maxMessages = this.maxHistory * 2;
    if (this.messages.length > maxMessages) {
      this.messages = this.messages.slice(-maxMessages);
    }
  }
}
```

### Integration in ChatEngine

```typescript
class ChatEngine {
  private session: ChatSession;

  constructor(/* ... */) {
    this.session = new ChatSession();
  }

  async ask(question: string): Promise<ChatResponse> {
    // Vorherige Konversation einbeziehen
    const history = this.session.getHistory();
    const response = await this.ragAsk(question, history);

    // Verlauf aktualisieren
    this.session.addUserMessage(question);
    this.session.addAssistantMessage(response.answer);

    return response;
  }
}
```

### Slash-Commands im interaktiven Modus

```text
/clear    – Konversation zurücksetzen
/history  – Zeige bisherigen Verlauf
/sources  – Zeige Quellen der letzten Antwort
/debug    – Zeige den letzten Prompt
/help     – Zeige Hilfe
/exit     – Beenden
```

### Akzeptanzkriterien
- [ ] Konversation wird im Speicher behalten
- [ ] Vorherige Nachrichten werden in den Prompt eingebaut
- [ ] `/clear` setzt den Verlauf zurück
- [ ] Maximale Länge des Verlaufs ist konfigurierbar

---

## Aufgabe 5: CLI-Chat-Modus

**Datei:** `src/cli.ts` (erweitern)

### Befehle

```bash
# Einzelfrage
ebook-ingest ask "Was ist Dependency Inversion?"

# Interaktiver Chat
ebook-ingest chat [--style default|academic|concise] [--top 5] [--no-sources]

# Einzelfrage mit Optionen
ebook-ingest ask "Was ist SRP?" --style concise --top 3 --source "Clean_Architecture"
```

### Interaktiver Chat

```text
╔══════════════════════════════════════════════════╗
║  🧠 Ask my Vault — Personal Knowledge Chat       ║
║  Type /help for commands, /exit to quit          ║
╚══════════════════════════════════════════════════╝

You: Was ist Dependency Inversion?

🤖 Assistant:
Dependency Inversion (DIP) ist ein Prinzip der Software-Architektur, das besagt:

- High-level modules should not depend on low-level modules [1]
- Both should depend on abstractions [1]
- Abstractions should not depend on details [2]

📚 Quellen:
  [1] Clean_Architecture/03.md
  [2] Clean_Code/05.md

─────────────────────────────────────────────────────

You: Kannst du das genauer erklären?

🤖 Assistant:
[Bezieht sich auf die vorherige Konversation und die Quellen...]
```

### Implementierung

```typescript
// In cli.ts
if (command === 'chat') {
  const engine = new ChatEngine(vectorStore, embeddingGenerator, config.model);
  await engine.chat(options);
} else if (command === 'ask') {
  const engine = new ChatEngine(vectorStore, embeddingGenerator, config.model);
  const response = await engine.ask(query);
  console.log(response.answer);
  console.log('\n📚 Quellen:');
  response.sources.forEach((s, i) => {
    console.log(`  [${i + 1}] ${s.vaultPath}`);
  });
}
```

### Akzeptanzkriterien
- [ ] `ask` beantwortet eine Einzelfrage
- [ ] `chat` startet interaktiven Modus
- [ ] Quellen werden angezeigt
- [ ] `/exit` beendet den Chat
- [ ] Leere Eingabe wird ignoriert

---

## Aufgabe 6: Zitieren von Quellen in Antworten

### Quellen-Extraktion aus LLM-Antwort

Das LLM zitiert Quellen mit `[1]`, `[2]` im Text. Der `ChatResponse`-Parser
extrahiert diese Nummern und verlinkt sie auf die tatsächlichen Quellen.

```typescript
private extractCitations(
  answer: string,
  documents: VectorDocument[],
): SourceCitation[] {
  const citedNumbers = new Set<number>();
  
  // Finde alle [Zahl]-Zitate in der Antwort
  const citationRegex = /\[(\d+)\]/g;
  let match;
  while ((match = citationRegex.exec(answer)) !== null) {
    const num = parseInt(match[1]);
    if (num > 0 && num <= documents.length) {
      citedNumbers.add(num);
    }
  }

  // Baue SourceCitation-Objekte für zitierte Quellen
  return Array.from(citedNumbers).map(num => {
    const doc = documents[num - 1];
    return {
      sourceName: doc.metadata.sourceName,
      blockIndex: doc.metadata.blockIndex,
      vaultPath: doc.metadata.vaultPath,
      excerpt: doc.text.slice(0, 300),
      relevanceScore: 0,
    };
  });
}
```

### Angezeigte Quellen

```text
📚 Quellen:
  [1] Clean_Architecture/03.md  (Kapitel: Dependency Inversion Principle)
  [2] Clean_Code/05.md          (Kapitel: Inversion of Control)
```

### Akzeptanzkriterien
- [ ] `[1]`, `[2]` in LLM-Antwort werden erkannt
- [ ] Nur tatsächlich zitierte Quellen werden angezeigt
- [ ] Quellen enthalten Source-Name und Pfad
- [ ] Wenn keine Zitate: "Keine Quellenangaben in der Antwort"

---

## Aufgabe 7: Streaming-Antworten

### Konzept

Statt auf die vollständige LLM-Antwort zu warten, wird die Antwort token-weise
ausgegeben (wie bei ChatGPT).

### Ollama Streaming

```typescript
async generateStream(prompt: string): Promise<AsyncGenerator<string>> {
  const stream = await ollama.chat({
    model: this.llmModel,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    options: {
      temperature: 0.3,
      num_predict: 1024,
    },
  });

  // ollama-js gibt bei stream:true einen AsyncGenerator zurück
  return stream;
}
```

### Verwendung im Chat-Modus

```typescript
// Token-weise Ausgabe
process.stdout.write('🤖 Assistant:\n');
for await (const chunk of await this.generateStream(prompt)) {
  process.stdout.write(chunk.message.content);
}
process.stdout.write('\n');
```

### Akzeptanzkriterien
- [ ] Antworten erscheinen token-weise (nicht auf einmal)
- [ ] Benutzer kann mit Ctrl+C abbrechen
- [ ] Quellen erscheinen erst nach vollständiger Antwort
- [ ] Streaming ist konfigurierbar (`--no-stream`)

---

## Aufgabe 8: Unit-Tests schreiben

**Neue Datei:** `tests/chat-engine.test.ts`

### Testfälle

#### RAG-Pipeline
- [ ] `ask()` ruft `retrieve()` → `buildPrompt()` → `generate()` auf
- [ ] Ohne ChromaDB: Fallback-Antwort
- [ ] Ohne relevante Quellen: "Kann ich nicht beantworten"
- [ ] Zitate werden korrekt extrahiert

#### Chat History
- [ ] Konversation wird gespeichert
- [ ] `/clear` setzt Verlauf zurück
- [ ] Maximale Länge wird eingehalten

#### Prompt-Templates
- [ ] `default`-Template wird verwendet
- [ ] `academic`-Template produziert ausführlicheren Prompt
- [ ] `concise`-Template fordert Bullet Points an

### Test-Setup

- Ollama-Aufrufe mocken (mit vordefinierten Antworten)
- ChromaDB-Aufrufe mocken
- Keine echte Ollama/ChromaDB-Instanz nötig

```typescript
// Beispiel-Mock für Ollama
jest.mock('ollama', () => ({
  chat: jest.fn().mockResolvedValue({
    message: {
      content: 'Dependency Inversion ist ein Prinzip... [1]',
    },
  }),
  embeddings: jest.fn().mockResolvedValue({
    embedding: Array(768).fill(0.1),
  }),
}));
```

---

## Zusammenfassung der neuen/geänderten Dateien

| Datei | Aktion |
| --- | --- |
| `src/chat-engine.ts` | **Neu** |
| `src/prompt-templates.ts` | **Neu** |
| `src/cli.ts` | Ändern (ask, chat Befehle) |
| `src/index.ts` | Ändern (neue Exports) |
| `src/config.ts` | Ggf. Ändern (chat options) |
| `tests/chat-engine.test.ts` | **Neu** |
