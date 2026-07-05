import fs from 'node:fs/promises';
import path from 'node:path';
import { EbookIngestConfig, defaultConfig } from './config.js';

/**
 * Migrate an existing vault from Book-Model (v2) to Source-Model (v3).
 *
 * Changes:
 * 1. 01_books/ → 05_sources/ (moves directories)
 * 2. Frontmatter: type:book→type:source, type:chapter→type:source_block, book:→source:
 * 3. Adds source_type: epub to all source files
 * 4. books_registry.json → sources_registry.json with new fields
 * 5. concept_registry.json: books→sources
 */
export async function migrateVault(
  vaultPath: string,
  options: { dryRun?: boolean } = {},
): Promise<string[]> {
  const dryRun = options.dryRun ?? false;
  const log: string[] = [];

  const logAction = (msg: string) => {
    const prefix = dryRun ? '[DRY-RUN] ' : '';
    log.push(`${prefix}${msg}`);
    console.log(`[MIGRATE] ${prefix}${msg}`);
  };

  // --- Step 1: Rename 01_books/ → 05_sources/ ---
  const oldBooksDir = path.resolve(vaultPath, '01_books');
  const newSourcesDir = path.resolve(vaultPath, '05_sources');

  try {
    await fs.access(oldBooksDir);
    logAction(`Move ${oldBooksDir} → ${newSourcesDir}`);
    if (!dryRun) {
      await fs.mkdir(path.dirname(newSourcesDir), { recursive: true });
      await fs.rename(oldBooksDir, newSourcesDir);
    }
  } catch {
    logAction(`No 01_books/ directory found — skipping move`);
  }

  // --- Step 2: Update frontmatter in all .md files ---
  if (!dryRun) {
    await updateFrontmatterInDir(newSourcesDir, logAction, dryRun);
    // Also check concepts directory
    const conceptsDir = path.resolve(vaultPath, '02_concepts');
    try {
      await fs.access(conceptsDir);
    } catch {
      // No concepts dir yet
    }
  } else {
    logAction('Would update frontmatter: type:book→type:source, type:chapter→type:source_block, book:→source:');
    logAction('Would add source_type: epub to all source files');
  }

  // --- Step 3: Migrate books_registry.json → sources_registry.json ---
  const metaDir = path.resolve(vaultPath, '99_meta');
  const oldBookReg = path.resolve(metaDir, 'books_registry.json');
  const newSourceReg = path.resolve(metaDir, 'sources_registry.json');

  try {
    const raw = await fs.readFile(oldBookReg, 'utf-8');
    const books = JSON.parse(raw) as Record<string, { project: string }>;

    const sources: Record<string, {
      project: string;
      source_type: string;
      original_path: string;
      ingested_at: string;
    }> = {};

    for (const [name, entry] of Object.entries(books)) {
      sources[name] = {
        project: entry.project,
        source_type: 'epub',
        original_path: '',
        ingested_at: '',
      };
    }

    logAction(`Migrate ${oldBookReg} → ${newSourceReg}`);
    if (!dryRun) {
      await fs.writeFile(newSourceReg, JSON.stringify(sources, null, 2) + '\n', 'utf-8');
    }
  } catch {
    logAction(`No books_registry.json found — skipping`);
  }

  // --- Step 4: Update concept_registry.json: books→sources ---
  const conceptReg = path.resolve(metaDir, 'concept_registry.json');
  try {
    const raw = await fs.readFile(conceptReg, 'utf-8');
    const concepts = JSON.parse(raw) as Record<string, { books?: string[] }>;

    const updated: Record<string, { sources: string[]; books?: string[] }> = {};
    for (const [name, entry] of Object.entries(concepts)) {
      updated[name] = {
        sources: entry.books ?? [],
        books: entry.books ?? [], // keep for backward compat
      };
    }

    logAction(`Update concept_registry.json: books→sources`);
    if (!dryRun) {
      await fs.writeFile(conceptReg, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
    }
  } catch {
    logAction(`No concept_registry.json found — skipping`);
  }

  logAction('Migration complete!');
  return log;
}

/**
 * Recursively update frontmatter in all .md files under a directory.
 */
async function updateFrontmatterInDir(
  dir: string,
  logAction: (msg: string) => void,
  _dryRun: boolean,
): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.resolve(dir, entry.name);

      if (entry.isDirectory()) {
        await updateFrontmatterInDir(fullPath, logAction, _dryRun);
      } else if (entry.name.endsWith('.md')) {
        const content = await fs.readFile(fullPath, 'utf-8');

        let updated = content
          .replace(/^type:\s*book\s*$/m, 'type: source')
          .replace(/^type:\s*chapter\s*$/m, 'type: source_block')
          .replace(/^book:\s*(.+)$/m, 'source: $1');

        // Add source_type if missing
        if (!/^source_type:/m.test(updated) && /^type:\s*source/m.test(updated)) {
          updated = updated.replace(
            /^(type:\s*source\s*)$/m,
            '$1\nsource_type: epub',
          );
        }
        if (!/^source_type:/m.test(updated) && /^type:\s*source_block/m.test(updated)) {
          updated = updated.replace(
            /^(type:\s*source_block\s*)$/m,
            '$1\nsource_type: epub',
          );
        }

        if (updated !== content) {
          logAction(`  Update frontmatter: ${path.relative(process.cwd(), fullPath)}`);
          await fs.writeFile(fullPath, updated, 'utf-8');
        }
      }
    }
  } catch {
    // Directory may not exist
  }
}

/**
 * CLI entry point for migration.
 */
export async function migrateCommand(
  config: EbookIngestConfig,
  dryRun: boolean,
): Promise<void> {
  console.log(`[MIGRATE] Vault: ${config.vault}`);
  console.log(`[MIGRATE] Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log('');

  await migrateVault(config.vault, { dryRun });
}
