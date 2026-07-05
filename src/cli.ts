import { defaultConfig, EbookIngestConfig } from './config.js';
import { UniversalExtractor } from './universal-extractor.js';
import { WikiPipeline } from './pipeline.js';

function parseArgs(argv: string[]): {
  sourcePath: string;
  sourceName: string;
  project: string;
  resume: boolean;
  config?: Partial<EbookIngestConfig>;
} {
  if (argv.length < 2) {
    console.error(
      'Usage: ebook-ingest <source> <source_name> [project] [--resume|-r] [--config <path>]',
    );
    console.error('');
    console.error('Supported formats: .epub, .pdf, .html, .htm, http://, https://');
    console.error('');
    console.error('Options:');
    console.error('  --resume, -r    Skip already-processed chapters/blocks');
    console.error('  --config <path>  Path to JSON config file (overrides defaults)');
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
      // Config file path — will be loaded and merged
      const configPath = argv[++i];
      // Dynamic import for config file
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Validate format early
  try {
    const format = UniversalExtractor.detectFormat(args.sourcePath);
    console.log(`[INFO] Detected format: ${format}`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const config: EbookIngestConfig = {
    ...defaultConfig,
    ...args.config,
  };

  const pipeline = new WikiPipeline(config);
  await pipeline.ingest(args.sourcePath, args.sourceName, args.project, args.resume);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
