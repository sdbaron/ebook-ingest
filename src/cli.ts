import { defaultConfig, EbookIngestConfig } from './config.js';
import { UniversalExtractor } from './universal-extractor.js';
import { ConceptMergeEngine } from './concept-merge-engine.js';
import { WikiPipeline } from './pipeline.js';
import { migrateCommand } from './migrate-vault.js';
import { VectorStore, buildDocId } from './vector-store.js';
import { EmbeddingGenerator } from './embedding-generator.js';
import path from 'node:path';

function printUsage(): void {
  console.error('Usage:');
  console.error('  ebook-ingest <source> <source_name> [project] [--resume|-r] [--config <path>]');
  console.error('  ebook-ingest migrate [--vault <path>] [--dry-run]');
  console.error('  ebook-ingest merge-concepts [--auto] [--dry-run]');
  console.error('  ebook-ingest search <query> [--top-k <n>]');
  console.error('  ebook-ingest reindex [--source <name>]');
  console.error('');
  console.error('Commands:');
  console.error('  ingest (default)  Import a source into the vault');
  console.error('  migrate           Migrate v2 vault (Book-Model) to v3 (Source-Model)');
  console.error('  merge-concepts    Find and merge duplicate concepts');
  console.error('  search            Semantic search over indexed vault content');
  console.error('  reindex           Regenerate embeddings for existing vault');
  console.error('');
  console.error('Search options:');
  console.error('  --top-k <n>       Number of results (default: 5)');
  console.error('');
  console.error('Reindex options:');
  console.error('  --source <name>   Only reindex a specific source');
  console.error('');
  console.error('Merge options:');
  console.error('  --auto            Auto-merge all candidates with score > 0.9');
  console.error('  --dry-run         Show merge candidates without executing');
  console.error('');
  console.error('Supported formats: .epub, .pdf, .html, .htm, http://, https://');
}

function parseIngestArgs(argv: string[]): {
  sourcePath: string;
  sourceName: string;
  project: string;
  resume: boolean;
  config?: Partial<EbookIngestConfig>;
} {
  if (argv.length < 2) {
    printUsage();
    process.exit(1);
  }

  const sourcePath = argv[0];
  const sourceName = argv[1];

  let project = 'General';
  let resume = false;
  let configOverride: Partial<EbookIngestConfig> | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--resume' || arg === '-r') {
      resume = true;
    } else if (arg === '--config' && i + 1 < argv.length) {
      const configPath = argv[++i];
      import(configPath)
        .then(mod => {
          configOverride = mod.default || mod;
        })
        .catch(err => {
          console.error(`Failed to load config file: ${err.message}`);
          process.exit(1);
        });
    } else if (!arg.startsWith('-')) {
      project = arg;
    }
  }

  return { sourcePath, sourceName, project, resume, config: configOverride };
}

function parseMigrateArgs(argv: string[]): {
  vault?: string;
  dryRun: boolean;
} {
  let vault: string | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--vault' && i + 1 < argv.length) {
      vault = argv[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { vault, dryRun };
}

async function mergeConceptsCommand(argv: string[]): Promise<void> {
  let auto = false;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === '--auto') auto = true;
    if (arg === '--dry-run') dryRun = true;
  }

  const config = defaultConfig;
  const conceptDir = path.resolve(config.vault, config.conceptsDir);
  const conceptRegPath = path.resolve(config.vault, config.conceptRegistry);
  const sourcesDir = path.resolve(config.vault, config.sourcesDir);

  const engine = new ConceptMergeEngine(conceptDir, conceptRegPath, sourcesDir);

  console.log('[MERGE] Finding concept merge candidates...');
  const candidates = await engine.findCandidates();

  if (candidates.length === 0) {
    console.log('[MERGE] No merge candidates found.');
    return;
  }

  console.log(`[MERGE] Found ${candidates.length} potential merge candidates:\n`);

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    console.log(`[${i + 1}] ${c.concepts[0]} ↔ ${c.concepts[1]} (score: ${c.score.toFixed(2)}, method: ${c.method})`);
    console.log(`    → Keep: "${c.suggestedPrimary}"`);
    console.log(`    → Alias: "${c.suggestedAlias}"\n`);
  }

  if (dryRun) {
    console.log('[MERGE] Dry run — no changes made.');
    return;
  }

  if (auto) {
    const toMerge = candidates.filter(c => c.score > 0.9);
    if (toMerge.length === 0) {
      console.log('[MERGE] No candidates above 0.9 threshold for auto-merge.');
      return;
    }
    console.log(`[MERGE] Auto-merging ${toMerge.length} candidates...`);
    const results = await engine.merge(toMerge);
    for (const r of results) {
      console.log(`[MERGE] Merged "${r.merged.join(', ')}" → "${r.primary}"`);
    }
  } else {
    console.log('[MERGE] Run with --auto to auto-merge candidates with score > 0.9');
    console.log('[MERGE] Run with --dry-run to preview without changes');
  }
}

async function searchCommand(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '--help') {
    console.error('Usage: ebook-ingest search <query> [--top-k <n>]');
    process.exit(1);
  }

  const query = argv[0];
  let topK = 5;

  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--top-k' && i + 1 < argv.length) {
      topK = parseInt(argv[++i], 10) || 5;
    }
  }

  const config = defaultConfig;
  const vectorStore = new VectorStore();
  const embeddingGenerator = new EmbeddingGenerator();

  await vectorStore.connect();

  if (!vectorStore.isConnected()) {
    console.error('[SEARCH] ChromaDB is not available. Start ChromaDB to use search.');
    process.exit(1);
  }

  console.log(`[SEARCH] Query: "${query}" (top-${topK})`);

  const queryEmbedding = await embeddingGenerator.embedQuery(query);
  const results = await vectorStore.query(queryEmbedding, topK);

  if (results.length === 0) {
    console.log('[SEARCH] No results found.');
    return;
  }

  console.log(`[SEARCH] Found ${results.length} results:\n`);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`[${i + 1}] ${r.metadata.sourceName} — Block ${r.metadata.blockIndex}`);
    console.log(`    ${r.text.slice(0, 200).replace(/\n/g, ' ')}...`);
    console.log('');
  }
}

async function reindexCommand(argv: string[]): Promise<void> {
  let sourceName: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source' && i + 1 < argv.length) {
      sourceName = argv[++i];
    }
  }

  const config = defaultConfig;
  const vectorStore = new VectorStore();
  await vectorStore.connect();

  if (!vectorStore.isConnected()) {
    console.error('[REINDEX] ChromaDB is not available.');
    process.exit(1);
  }

  if (sourceName) {
    console.log(`[REINDEX] Reindexing source: ${sourceName}`);
    await vectorStore.deleteSource(sourceName);
    // Re-indexing would require re-processing via the pipeline
    console.log(`[REINDEX] Deleted vectors for "${sourceName}". Run ingest --resume to regenerate.`);
  } else {
    console.log('[REINDEX] Full reindex not yet implemented. Use --source <name> for per-source reindex.');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle subcommands
  if (args[0] === 'migrate') {
    const migrateArgs = parseMigrateArgs(args.slice(1));
    const config: EbookIngestConfig = {
      ...defaultConfig,
      ...(migrateArgs.vault ? { vault: migrateArgs.vault } : {}),
    };
    await migrateCommand(config, migrateArgs.dryRun);
    return;
  }

  if (args[0] === 'merge-concepts') {
    await mergeConceptsCommand(args.slice(1));
    return;
  }

  if (args[0] === 'search') {
    await searchCommand(args.slice(1));
    return;
  }

  if (args[0] === 'reindex') {
    await reindexCommand(args.slice(1));
    return;
  }

  if (args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const ingestArgs = parseIngestArgs(args);

  // Validate format early
  try {
    const format = UniversalExtractor.detectFormat(ingestArgs.sourcePath);
    console.log(`[INFO] Detected format: ${format}`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const config: EbookIngestConfig = {
    ...defaultConfig,
    ...ingestArgs.config,
  };

  const pipeline = new WikiPipeline(config);
  await pipeline.ingest(ingestArgs.sourcePath, ingestArgs.sourceName, ingestArgs.project, ingestArgs.resume);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
