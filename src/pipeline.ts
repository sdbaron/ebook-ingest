import path from 'node:path';
import { EbookIngestConfig } from './config.js';
import { UniversalExtractor } from './universal-extractor.js';
import { TextPreprocessor } from './text-preprocessor.js';
import { LLMAnalyzer, ConceptEntry } from './llm-analyzer.js';
import { ConceptNormalizer } from './concept-normalizer.js';
import { RegistryManager } from './registry-manager.js';
import { KnowledgeStore } from './knowledge-store.js';
import { ObsidianWriter } from './obsidian-writer.js';

/**
 * Main pipeline: EPUB → LLM analysis → Obsidian vault.
 */
export class WikiPipeline {
  private config: EbookIngestConfig;
  private writer: ObsidianWriter;
  private knowledgeStore: KnowledgeStore;
  private llmAnalyzer: LLMAnalyzer;
  private extractor: UniversalExtractor;

  constructor(config: EbookIngestConfig) {
    this.config = config;
    this.llmAnalyzer = new LLMAnalyzer(config.model);

    const conceptRegPath = path.resolve(config.vault, config.conceptRegistry);
    const sourceRegPath = path.resolve(config.vault, config.sourceRegistry);

    this.writer = new ObsidianWriter(
      config.vault,
      config.booksDir,
      config.sourcesDir,
      config.conceptsDir,
      config.mocDir,
      conceptRegPath,
    );

    this.knowledgeStore = new KnowledgeStore(conceptRegPath, sourceRegPath);

    const preprocessor = new TextPreprocessor();
    this.extractor = new UniversalExtractor(preprocessor);
  }

  /**
   * Run the full ingestion pipeline.
   *
   * @param sourcePath Path to the source file (epub, pdf, html) or URL
   * @param sourceName Name of the source (used as directory/filename)
   * @param project    Project association (default: "General")
   * @param resume     Skip already-processed chapters/blocks
   */
  async ingest(
    sourcePath: string,
    sourceName: string,
    project: string = 'General',
    resume: boolean = false,
  ): Promise<void> {
    const conceptRegPath = path.resolve(this.config.vault, this.config.conceptRegistry);
    const sourceRegPath = path.resolve(this.config.vault, this.config.sourceRegistry);
    const metaDir = path.resolve(this.config.vault, this.config.metaDir);

    await RegistryManager.ensure(metaDir, conceptRegPath, sourceRegPath);

    console.log(`[INFO] Reading "${sourceName}" from ${sourcePath}`);

    const extractionResult = await this.extractor.extract(sourcePath);
    const blocks = extractionResult.blocks;

    console.log(`[INFO] Format: ${extractionResult.format}, Blocks: ${blocks.length}`);

    if (resume) {
      console.log('[INFO] Resume mode: skipping already-processed blocks');
    }

    const allConcepts = new Set<string>();
    let skippedCount = 0;

    for (let i = 0; i < blocks.length; i++) {
      const blockNum = i + 1;
      const blockText = blocks[i];

      // Resume: skip if block file already exists (check both new and old dirs)
      const resumePaths = [
        path.resolve(this.config.vault, this.config.sourcesDir, sourceName, `${String(blockNum).padStart(2, '0')}.md`),
        path.resolve(this.config.vault, this.config.booksDir, sourceName, `${String(blockNum).padStart(2, '0')}.md`),
      ];

      if (resume) {
        let alreadyExists = false;
        for (const p of resumePaths) {
          try {
            await import('node:fs/promises').then(fs => fs.access(p));
            alreadyExists = true;
            break;
          } catch { /* try next */ }
        }
        if (alreadyExists) {
          console.log(`[SKIP] Block ${blockNum} (already processed)`);
          skippedCount++;
          const existingConcepts = await this.writer.extractConceptsFromChapter(
            sourceName,
            blockNum,
          );
          existingConcepts.forEach(c => allConcepts.add(c));
          continue;
        }
      }

      console.log(`[LLM] Block ${blockNum}`);

      const result = await this.llmAnalyzer.analyze(blockText);

      await this.writer.writeSourceBlock(sourceName, project, blockNum, result, extractionResult.format);

      for (const concept of result.concepts) {
        const rec = concept as unknown as { name?: string; title?: string; term?: string };
        const conceptName = rec.name || rec.title || rec.term || '';

        if (!conceptName) {
          console.warn(
            `[WARN] Block ${blockNum}: Skipping concept without recognizable name. Keys: ${Object.keys(concept).join(', ')}`,
          );
          continue;
        }

        const description =
          concept.description ||
          (concept as ConceptEntry & { summary?: string }).summary ||
          (concept as ConceptEntry & { definition?: string }).definition ||
          '';

        const name = ConceptNormalizer.normalize(conceptName);

        allConcepts.add(name);

        await this.knowledgeStore.registerConcept(name, sourceName);

        await this.writer.updateConcept(name, description, sourceName);
      }
    }

    if (resume && skippedCount > 0) {
      console.log(`[INFO] Skipped ${skippedCount} already-processed blocks`);
    }

    await this.knowledgeStore.registerSource(
      sourceName,
      project,
      extractionResult.format,
      sourcePath,
    );

    await this.writer.writeSourceIndex(sourceName, blocks.length, allConcepts, extractionResult.format);

    await this.writer.writeGlobalMoc();

    console.log('[DONE]');
  }
}
