import path from 'node:path';
import fs from 'node:fs';

/**
 * WIKI_CONTENT_STANDARD.md compliant note types.
 */
export type WikiNoteType =
  | 'concept' | 'book' | 'author' | 'pattern'
  | 'standard' | 'decision' | 'index';

/**
 * Configuration for WIKI_CONTENT_STANDARD.md compliance.
 */
export interface WikiStandardConfig {
  /** Enable frontmatter compliance (default: true) */
  enabled: boolean;
  /** Owner abbreviation for all generated notes */
  defaultOwner: string;
  /** Fallback domain when project is not derivable */
  defaultDomain: string;
  /**
   * Mapping SourceFormat → note type for source BLOCK notes.
   * Source-index notes always use 'index', concepts always 'concept'.
   */
  blockTypeMapping: Record<string, WikiNoteType>;
}

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
  /** Directory for copied/extracted images */
  attachmentsDir: string;
  /** Ollama model to use for LLM analysis */
  model: string;
  /** WIKI_CONTENT_STANDARD compliance settings */
  wikiStandard: WikiStandardConfig;
}

/**
 * Default configuration.
 * Override by providing a custom config object to the pipeline,
 * by placing a config file in the current directory, or via --config.
 */
export const defaultConfig: EbookIngestConfig = {
  vault: "/Users/sergeydaub/work/barmbini/ObsidianVault",
  /** Generated notes live under wiki/ (raw/ stays at vault root). */
  booksDir: "wiki/01_books",
  sourcesDir: "wiki/05_sources",
  conceptsDir: "wiki/02_concepts",
  mocDir: "wiki/04_mocs",
  metaDir: "wiki/99_meta",
  conceptRegistry: "wiki/99_meta/concept_registry.json",
  bookRegistry: "wiki/99_meta/books_registry.json",
  sourceRegistry: "wiki/99_meta/sources_registry.json",
  attachmentsDir: "wiki/06_attachments",
  model: "llama3.2:latest",
  wikiStandard: {
    enabled: true,
    defaultOwner: 'unassigned',
    defaultDomain: 'general',
    blockTypeMapping: {
      epub: 'book',
      fb2: 'book',
      pdf: 'book',
      html: 'pattern',
      url: 'pattern',
    },
  },
};

/**
 * Resolve a relative path within the vault root.
 */
export function resolveVaultPath(config: EbookIngestConfig, ...segments: string[]): string {
  return path.resolve(config.vault, ...segments);
}

// ── Config file auto-discovery ────────────────────────────────────────────

/**
 * File names searched (in order) when looking for a config file
 * in the current working directory.
 */
export const CONFIG_SEARCH_NAMES = [
  '.ebook-ingestrc',
  '.ebook-ingestrc.json',
  '.ebook-ingest.json',
  'ebook-ingest.config.json',
] as const;

/**
 * Check whether a value is a plain object (not null, array, Date, …).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date);
}

/**
 * Deep-merge `source` into `target`.
 * Arrays and scalars from `source` replace those in `target`;
 * nested plain objects are merged recursively.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];

    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }

  return result;
}

/**
 * Search `cwd` for an existing config file.
 * Returns the absolute path of the first file found, or `null`.
 */
export function findConfigFile(
  cwd: string = process.cwd(),
): string | null {
  for (const name of CONFIG_SEARCH_NAMES) {
    const candidate = path.resolve(cwd, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Load and merge configuration.
 *
 * Resolution order (later overrides earlier):
 * 1. Built-in defaults (`defaultConfig`)
 * 2. Auto-discovered config file in `cwd` (`.ebook-ingestrc`, …)
 * 3. Explicit `configPath` (e.g. from `--config`)
 *
 * @param cwd         Directory to search for auto-discovered config files
 * @param configPath  Optional explicit path to a config JSON file
 * @returns Fully merged EbookIngestConfig
 */
export function loadConfig(
  cwd: string = process.cwd(),
  configPath?: string,
): EbookIngestConfig {
  let merged: Record<string, unknown> = { ...defaultConfig };

  // 1. Auto-discovered config (always searched, even with explicit path)
  const autoPath = findConfigFile(cwd);
  if (autoPath) {
    try {
      const raw = fs.readFileSync(autoPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (isPlainObject(parsed)) {
        merged = deepMerge(merged, parsed);
      }
    } catch (err) {
      console.warn(
        `[CONFIG] Failed to parse auto-discovered config "${autoPath}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // 2. Explicit --config path
  if (configPath) {
    const resolved = path.resolve(cwd, configPath);
    try {
      const raw = fs.readFileSync(resolved, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (isPlainObject(parsed)) {
        merged = deepMerge(merged, parsed);
      }
    } catch (err) {
      console.warn(
        `[CONFIG] Failed to parse explicit config "${resolved}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return merged as unknown as EbookIngestConfig;
}
