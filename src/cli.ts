import { defaultConfig, EbookIngestConfig } from './config.js';
import { UniversalExtractor } from './universal-extractor.js';
import { WikiPipeline } from './pipeline.js';
import { migrateCommand } from './migrate-vault.js';

function printUsage(): void {
  console.error('Usage:');
  console.error('  ebook-ingest <source> <source_name> [project] [--resume|-r] [--config <path>]');
  console.error('  ebook-ingest migrate [--vault <path>] [--dry-run]');
  console.error('');
  console.error('Commands:');
  console.error('  ingest (default)  Import a source into the vault');
  console.error('  migrate           Migrate v2 vault (Book-Model) to v3 (Source-Model)');
  console.error('');
  console.error('Ingest options:');
  console.error('  --resume, -r      Skip already-processed blocks');
  console.error('  --config <path>   Path to JSON config file (overrides defaults)');
  console.error('');
  console.error('Migrate options:');
  console.error('  --vault <path>    Path to the Obsidian vault');
  console.error('  --dry-run         Show what would change without writing');
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
