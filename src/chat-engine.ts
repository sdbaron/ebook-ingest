import ollama from 'ollama';
import { VectorStore, VectorDocument } from './vector-store.js';
import { EmbeddingGenerator } from './embedding-generator.js';
import { PromptTemplate, promptTemplates } from './prompt-templates.js';

/**
 * A message in the chat conversation.
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * A source citation from the knowledge base.
 */
export interface SourceCitation {
  sourceName: string;
  blockIndex: number;
  vaultPath: string;
  excerpt: string;
}

/**
 * The full response from the chat engine.
 */
export interface ChatResponse {
  answer: string;
  sources: SourceCitation[];
  rawPrompt?: string;
}

/**
 * RAG-based chat engine: Retrieve → Augment → Generate.
 *
 * Combines ChromaDB vector search with Ollama LLM for context-aware
 * answers based on the entire vault content.
 */
export class ChatEngine {
  private vectorStore: VectorStore;
  private embeddingGenerator: EmbeddingGenerator;
  private llmModel: string;
  private template: PromptTemplate;
  private session: ChatSession;

  constructor(
    vectorStore: VectorStore,
    embeddingGenerator: EmbeddingGenerator,
    llmModel: string,
    template?: PromptTemplate,
  ) {
    this.vectorStore = vectorStore;
    this.embeddingGenerator = embeddingGenerator;
    this.llmModel = llmModel;
    this.template = template || promptTemplates.default;
    this.session = new ChatSession();
  }

  /**
   * Answer a question using RAG (Retrieve → Augment → Generate).
   */
  async ask(
    question: string,
    options?: { topK?: number; showSources?: boolean },
  ): Promise<ChatResponse> {
    const topK = options?.topK ?? 5;
    const history = this.session.getHistory();

    // Step 1: Retrieve
    const documents = await this.retrieve(question, topK);

    if (documents.length === 0 && !this.vectorStore.isConnected()) {
      // Fallback: pure LLM without context
      const answer = await this.generateDirect(question, history);
      this.session.addUserMessage(question);
      this.session.addAssistantMessage(answer);
      return { answer, sources: [] };
    }

    if (documents.length === 0) {
      const answer = 'Keine relevanten Quellen gefunden. Bitte stelle eine andere Frage oder indexiere mehr Dokumente.';
      return { answer, sources: [] };
    }

    // Step 2: Augment (build prompt with context)
    const prompt = this.buildAugmentedPrompt(question, documents, history);

    // Step 3: Generate
    const answer = await this.generate(prompt);

    // Build source citations
    const sources: SourceCitation[] = documents.map(doc => ({
      sourceName: doc.metadata.sourceName,
      blockIndex: doc.metadata.blockIndex,
      vaultPath: doc.metadata.vaultPath,
      excerpt: doc.text.slice(0, 300),
    }));

    // Update session
    this.session.addUserMessage(question);
    this.session.addAssistantMessage(answer);

    return { answer, sources, rawPrompt: prompt };
  }

  /**
   * Start an interactive chat session (reads from stdin).
   */
  async chat(options?: { topK?: number; showSources?: boolean }): Promise<void> {
    const topK = options?.topK ?? 5;
    const showSources = options?.showSources ?? false;

    console.log('[CHAT] Ask my Vault — interactive chat mode');
    console.log('[CHAT] Type /help for commands, /exit to quit\n');

    // Simple readline loop
    const readline = await import('node:readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ask_question = (): Promise<string> => {
      return new Promise(resolve => {
        rl.question('You: ', resolve);
      });
    };

    while (true) {
      const input = await ask_question();

      if (input === '/exit' || input === '/quit') {
        console.log('[CHAT] Goodbye!');
        rl.close();
        break;
      }

      if (input === '/clear') {
        this.session.clear();
        console.log('[CHAT] Session cleared.');
        continue;
      }

      if (input === '/history') {
        const history = this.session.getHistory();
        if (history.length === 0) {
          console.log('[CHAT] No conversation history.');
        } else {
          for (const msg of history) {
            console.log(`[${msg.role}] ${msg.content.slice(0, 100)}...`);
          }
        }
        continue;
      }

      if (input === '/sources') {
        console.log('[CHAT] Sources from last response are shown after each answer (use --show-sources).');
        continue;
      }

      if (input === '/debug') {
        console.log('[CHAT] Last raw prompt is available via API (rawPrompt field).');
        continue;
      }

      if (input === '/help') {
        console.log('Commands: /clear, /history, /sources, /debug, /exit');
        continue;
      }

      if (!input.trim()) continue;

      process.stdout.write('[CHAT] Thinking... ');
      const response = await this.ask(input, { topK, showSources });
      process.stdout.write('\r' + ' '.repeat(20) + '\r'); // Clear "Thinking..."

      console.log(`Assistant: ${response.answer}`);

      if (showSources && response.sources.length > 0) {
        console.log('\nSources:');
        for (const s of response.sources) {
          console.log(`  - ${s.sourceName} (Block ${s.blockIndex})`);
        }
      }
      console.log('');
    }
  }

  /**
   * Retrieve relevant documents from the vector store.
   */
  private async retrieve(query: string, topK: number): Promise<VectorDocument[]> {
    if (!this.vectorStore.isConnected()) return [];

    try {
      const queryEmbedding = await this.embeddingGenerator.embedQuery(query);
      return this.vectorStore.query(queryEmbedding, topK);
    } catch {
      return [];
    }
  }

  /**
   * Build the augmented prompt with context from retrieved documents.
   */
  private buildAugmentedPrompt(
    question: string,
    documents: VectorDocument[],
    history?: ChatMessage[],
  ): string {
    const contextParts = documents.map((doc, i) => {
      return `[Quelle ${i + 1}: ${doc.metadata.sourceName}, Block ${doc.metadata.blockIndex}]\n${doc.text.slice(0, 1000)}`;
    });

    const context = contextParts.join('\n\n');
    const historyText = history && history.length > 0
      ? `\nBisherige Konversation:\n${history.map(m => `${m.role}: ${m.content}`).join('\n')}\n`
      : '';

    return [
      this.template.systemPrompt,
      historyText,
      this.template.contextWrapper(context),
      this.template.questionWrapper(question),
    ].filter(Boolean).join('\n');
  }

  /**
   * Generate answer using the augmented prompt.
   */
  private async generate(prompt: string): Promise<string> {
    const response = await ollama.chat({
      model: this.llmModel,
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: 0.3,
        num_predict: 1024,
      },
    });

    return response.message.content;
  }

  /**
   * Generate answer directly without vector context (fallback).
   */
  private async generateDirect(question: string, history?: ChatMessage[]): Promise<string> {
    const response = await ollama.chat({
      model: this.llmModel,
      messages: [
        { role: 'system', content: 'Du bist ein Wissens-Assistent. Beantworte Fragen so gut du kannst.' },
        ...(history || []),
        { role: 'user', content: question },
      ],
      options: { temperature: 0.5, num_predict: 512 },
    });

    return response.message.content;
  }

  /**
   * Set the prompt template style.
   */
  setTemplate(template: PromptTemplate): void {
    this.template = template;
  }

  /**
   * Get the current session.
   */
  getSession(): ChatSession {
    return this.session;
  }
}

/**
 * Manages conversation history in-memory (not persisted).
 */
export class ChatSession {
  private messages: ChatMessage[] = [];
  private maxHistory: number;

  constructor(maxHistory: number = 10) {
    this.maxHistory = maxHistory;
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content });
    this.trim();
  }

  addAssistantMessage(content: string): void {
    this.messages.push({ role: 'assistant', content });
    this.trim();
  }

  getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  private trim(): void {
    const max = this.maxHistory * 2;
    if (this.messages.length > max) {
      this.messages = this.messages.slice(-max);
    }
  }
}
