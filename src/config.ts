import path from 'node:path';

/**
 * Configuration for the ebook-ingest pipeline.
 * All paths and defaults are centralized here.
 */
export interface EbookIngestConfig {
  /** Root path of the Obsidian vault */
  vault: string;
  /** @deprecated Use sourcesDir */
  booksDir: string;
  /** Directory for source notes (books, PDFs, URLs) */
  sourcesDir: string;
  /** Directory for concept notes */
  conceptsDir: string;
  /** Directory for Maps of Content */
  mocDir: string;
  /** Directory for metadata/registries */
  metaDir: string;
  /** Path to the concept registry JSON file */
  conceptRegistry: string;
  /** @deprecated Use sourceRegistry */
  bookRegistry: string;
  /** Path to the source registry JSON file */
  sourceRegistry: string;
  /** Ollama model to use for LLM analysis */
  model: string;
}

/**
 * Default configuration.
 * Override by providing a custom config object to the pipeline.
 */
export const defaultConfig: EbookIngestConfig = {
  vault: "/Users/sergeydaub/work/barmbini/ObsidianVault",
  booksDir: "01_books",
  sourcesDir: "05_sources",
  conceptsDir: "02_concepts",
  mocDir: "04_mocs",
  metaDir: "99_meta",
  conceptRegistry: "99_meta/concept_registry.json",
  bookRegistry: "99_meta/books_registry.json",
  sourceRegistry: "99_meta/sources_registry.json",
  model: "llama3.2:latest",
};

/**
 * Resolve a relative path within the vault root.
 */
export function resolveVaultPath(config: EbookIngestConfig, ...segments: string[]): string {
  return path.resolve(config.vault, ...segments);
}
