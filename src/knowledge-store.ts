import { RegistryManager } from './registry-manager.js';

export interface BookEntry {
  project: string;
}

export interface ConceptEntry {
  books: string[];
}

/**
 * Manage concept and book registries.
 */
export class KnowledgeStore {
  private conceptRegistryPath: string;
  private bookRegistryPath: string;

  constructor(conceptRegistryPath: string, bookRegistryPath: string) {
    this.conceptRegistryPath = conceptRegistryPath;
    this.bookRegistryPath = bookRegistryPath;
  }

  /**
   * Register a book with its associated project.
   */
  async registerBook(bookName: string, project: string): Promise<void> {
    const books = await RegistryManager.load<Record<string, BookEntry>>(this.bookRegistryPath);
    books[bookName] = { project };
    await RegistryManager.save(this.bookRegistryPath, books);
  }

  /**
   * Register a concept and associate it with a book.
   */
  async registerConcept(concept: string, bookName: string): Promise<void> {
    const registry = await RegistryManager.load<Record<string, ConceptEntry>>(
      this.conceptRegistryPath,
    );

    if (!registry[concept]) {
      registry[concept] = { books: [] };
    }

    if (!registry[concept].books.includes(bookName)) {
      registry[concept].books.push(bookName);
    }

    await RegistryManager.save(this.conceptRegistryPath, registry);
  }
}
