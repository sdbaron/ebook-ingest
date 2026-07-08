import { loadConfig, EbookIngestConfig } from './config.js';
import { UniversalExtractor } from './universal-extractor.js';
import { ConceptMergeEngine } from './concept-merge-engine.js';
import { WikiPipeline } from './pipeline.js';
import { migrateCommand } from './migrate-vault.js';
import { migrateWikiStandard } from './migrate-wiki-standard.js';
import { VectorStore, buildDocId } from './vector-store.js';
import { EmbeddingGenerator } from './embedding-generator.js';
import { ChatEngine } from './chat-engine.js';
import { promptTemplates } from './prompt-templates.js';
import { MocGenerator } from './moc-generator.js';
import path from 'node:path';

function printUsage(): void {
  console.error('Usage:');
  console.error('  ebook-ingest <source> <source_name> [project] [--resume|-r] [--config <path>]');
  console.error('  ebook-ingest migrate [--vault <path>] [--dry-run]');
  console.error('  ebook-ingest merge-concepts [--auto] [--dry-run]');
  console.error('  ebook-ingest search <query> [--top-k <n>]');
  console.error('  ebook-ingest reindex [--source <name>]');
  console.error('  ebook-ingest ask <question> [--top-k <n>] [--style default|academic|concise] [--show-sources]');
  console.error('  ebook-ingest chat [--top-k <n>] [--style default|academic|concise]');
  console.error('  ebook-ingest generate-mocs [--clusters <n>]');
  console.error('  ebook-ingest migrate-wiki-standard [--vault <path>] [--dry-run]');
  console.error('');
  console.error('Commands:');
  console.error('  ingest (default)      Import a source into the vault');
  console.error('  migrate               Migrate v2 vault (Book-Model) to v3 (Source-Model)');
  console.error('  migrate-wiki-standard Add WIKI_CONTENT_STANDARD.md frontmatter to existing notes');
  console.error('  merge-concepts        Find and merge duplicate concepts');
  console.error('  search            Semantic search over indexed vault content');
  console.error('  reindex           Regenerate embeddings for existing vault');
  console.error('  ask               Ask a question using RAG (single question)');
  console.error('  chat              Interactive RAG chat session');
  console.error('  generate-mocs     Auto-generate Maps of Content from concepts');
  console.error('');
  console.error('Ask/Chat options:');
  console.error('  --top-k <n>       Number of context documents (default: 5)');
  console.error('  --style <name>    Prompt style: default, academic, concise');
  console.error('  --show-sources    Show source citations in answer');
  console.error('');
  console.error('MOC options:');
  console.error('  --clusters <n>    Number of clusters (auto-detected if not specified)');
  console.error('');
  console.error('Supported formats: .epub, .pdf, .fb2, .html, .htm, http://, https://');
}

function parseIngestArgs(argv: string[]): {
  sourcePath: string;
  sourceName: string;
  project: string;
  resume: boolean;
  configPath?: string;
} {
  if (argv.length < 2) {
    printUsage();
    process.exit(1);
  }

  const sourcePath = argv[0];
  const sourceName = argv[1];

  let project = 'General';
  let resume = false;
  let configPath: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--resume' || arg === '-r') {
      resume = true;
    } else if (arg === '--config' && i + 1 < argv.length) {
      configPath = argv[++i];
    } else if (!arg.startsWith('-')) {
      project = arg;
    }
  }

  return { sourcePath, sourceName, project, resume, configPath };
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

  const config = loadConfig();
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

  const config = loadConfig();
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

  const config = loadConfig();
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

async function askCommand(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '--help') {
    console.error('Usage: ebook-ingest ask <question> [--top-k <n>] [--style default|academic|concise] [--show-sources]');
    process.exit(1);
  }

  const question = argv[0];
  let topK = 5;
  let showSources = false;
  let style = 'default';

  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--top-k' && i + 1 < argv.length) topK = parseInt(argv[++i], 10) || 5;
    if (argv[i] === '--show-sources') showSources = true;
    if (argv[i] === '--style' && i + 1 < argv.length) style = argv[++i];
  }

  const config = loadConfig();
  const vectorStore = new VectorStore();
  const embeddingGenerator = new EmbeddingGenerator();
  const template = promptTemplates[style] || promptTemplates.default;

  await vectorStore.connect();

  const engine = new ChatEngine(vectorStore, embeddingGenerator, config.model, template);
  const response = await engine.ask(question, { topK, showSources });

  console.log(response.answer);

  if (showSources && response.sources.length > 0) {
    console.log('\n--- Sources ---');
    for (const s of response.sources) {
      console.log(`  [${s.sourceName}] Block ${s.blockIndex}: ${s.excerpt.slice(0, 100)}...`);
    }
  }
}

async function chatCommand(argv: string[]): Promise<void> {
  let topK = 5;
  let showSources = false;
  let style = 'default';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--top-k' && i + 1 < argv.length) topK = parseInt(argv[++i], 10) || 5;
    if (argv[i] === '--show-sources') showSources = true;
    if (argv[i] === '--style' && i + 1 < argv.length) style = argv[++i];
  }

  const config = loadConfig();
  const vectorStore = new VectorStore();
  const embeddingGenerator = new EmbeddingGenerator();
  const template = promptTemplates[style] || promptTemplates.default;

  await vectorStore.connect();

  const engine = new ChatEngine(vectorStore, embeddingGenerator, config.model, template);
  await engine.chat({ topK, showSources });
}

async function generateMocsCommand(argv: string[]): Promise<void> {
  let numClusters: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--clusters' && i + 1 < argv.length) {
      numClusters = parseInt(argv[++i], 10) || undefined;
    }
  }

  const config = loadConfig();
  const embeddingGenerator = new EmbeddingGenerator();

  const conceptsDir = path.resolve(config.vault, config.conceptsDir);
  const mocDir = path.resolve(config.vault, config.mocDir);
  const sourceRegPath = path.resolve(config.vault, config.sourceRegistry);

  const generator = new MocGenerator(
    embeddingGenerator,
    conceptsDir,
    mocDir,
    sourceRegPath,
    config.model,
  );

  await generator.generate(numClusters);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle subcommands
  if (args[0] === 'migrate') {
    const migrateArgs = parseMigrateArgs(args.slice(1));
    const config: EbookIngestConfig = {
      ...loadConfig(),
      ...(migrateArgs.vault ? { vault: migrateArgs.vault } : {}),
    };
    await migrateCommand(config, migrateArgs.dryRun);
    return;
  }

  if (args[0] === 'migrate-wiki-standard') {
    let vault: string | undefined;
    let dryRun = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--vault' && i + 1 < args.length) vault = args[++i];
      if (args[i] === '--dry-run') dryRun = true;
    }
    const config = {
      ...loadConfig(),
      ...(vault ? { vault } : {}),
    };
    await migrateWikiStandard(config, dryRun);
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

  if (args[0] === 'ask') {
    await askCommand(args.slice(1));
    return;
  }

  if (args[0] === 'chat') {
    await chatCommand(args.slice(1));
    return;
  }

  if (args[0] === 'generate-mocs') {
    await generateMocsCommand(args.slice(1));
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

  const config = loadConfig(process.cwd(), ingestArgs.configPath);

  const pipeline = new WikiPipeline(config);
  await pipeline.ingest(ingestArgs.sourcePath, ingestArgs.sourceName, ingestArgs.project, ingestArgs.resume);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
