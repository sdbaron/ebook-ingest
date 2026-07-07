import { RegistryManager } from './registry-manager.js';

/** @deprecated Use SourceEntry */
export interface BookEntry {
  project: string;
}

export interface SourceEntry {
  project: string;
  source_type: 'epub' | 'pdf' | 'html' | 'url' | 'fb2';
  original_path: string;
  ingested_at: string;
}

export interface ConceptEntry {
  /** @deprecated Use sources */
  books: string[];
  sources: string[];
  aliases?: string[];
  merged_from?: string[];
}

/**
 * Manage concept and source registries.
 */
export class KnowledgeStore {
  private conceptRegistryPath: string;
  private sourceRegistryPath: string;
  /** @deprecated Use sourceRegistryPath */
  private bookRegistryPath: string;

  constructor(conceptRegistryPath: string, sourceRegistryPath: string) {
    this.conceptRegistryPath = conceptRegistryPath;
    this.sourceRegistryPath = sourceRegistryPath;
    this.bookRegistryPath = sourceRegistryPath;
  }

  /**
   * Register a source with its metadata.
   */
  async registerSource(
    sourceName: string,
    project: string,
    sourceType: SourceEntry['source_type'],
    originalPath: string,
  ): Promise<void> {
    const sources = await RegistryManager.load<Record<string, SourceEntry>>(
      this.sourceRegistryPath,
    );
    sources[sourceName] = {
      project,
      source_type: sourceType,
      original_path: originalPath,
      ingested_at: new Date().toISOString(),
    };
    await RegistryManager.save(this.sourceRegistryPath, sources);
  }

  /** @deprecated Use registerSource */
  async registerBook(bookName: string, project: string): Promise<void> {
    return this.registerSource(bookName, project, 'epub', bookName);
  }

  /**
   * Register a concept and associate it with a source.
   */
  async registerConcept(concept: string, sourceName: string): Promise<void> {
    const registry = await RegistryManager.load<Record<string, ConceptEntry>>(
      this.conceptRegistryPath,
    );

    if (!registry[concept]) {
      registry[concept] = { books: [], sources: [] };
    }

    // Populate both `sources` and `books` for backward compatibility
    if (!registry[concept].sources.includes(sourceName)) {
      registry[concept].sources.push(sourceName);
    }
    if (!registry[concept].books.includes(sourceName)) {
      registry[concept].books.push(sourceName);
    }

    await RegistryManager.save(this.conceptRegistryPath, registry);
  }
}
