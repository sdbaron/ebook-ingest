import path from 'node:path';
import { EbookIngestConfig } from './config.js';
import { EpubExtractor } from './epub-extractor.js';
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

  constructor(config: EbookIngestConfig) {
    this.config = config;
    this.llmAnalyzer = new LLMAnalyzer(config.model);

    const conceptRegPath = path.resolve(config.vault, config.conceptRegistry);
    const bookRegPath = path.resolve(config.vault, config.bookRegistry);

    this.writer = new ObsidianWriter(
      config.vault,
      config.booksDir,
      config.conceptsDir,
      config.mocDir,
      conceptRegPath,
    );

    this.knowledgeStore = new KnowledgeStore(conceptRegPath, bookRegPath);
  }

  /**
   * Run the full ingestion pipeline.
   */
  async ingest(
    epubPath: string,
    bookName: string,
    project: string = 'General',
    resume: boolean = false,
  ): Promise<void> {
    const conceptRegPath = path.resolve(this.config.vault, this.config.conceptRegistry);
    const bookRegPath = path.resolve(this.config.vault, this.config.bookRegistry);
    const metaDir = path.resolve(this.config.vault, this.config.metaDir);

    await RegistryManager.ensure(metaDir, conceptRegPath, bookRegPath);

    console.log(`[INFO] Reading ${bookName}`);

    const chapters = await EpubExtractor.extract(epubPath);

    console.log(`[INFO] Chapters: ${chapters.length}`);

    if (resume) {
      console.log('[INFO] Resume mode: skipping already-processed chapters');
    }

    const allConcepts = new Set<string>();
    let skippedCount = 0;

    for (let i = 0; i < chapters.length; i++) {
      const chapterNum = i + 1;
      const chapter = chapters[i];

      // Resume: skip if chapter file already exists
      const chapterPath = path.resolve(
        this.config.vault,
        this.config.booksDir,
        bookName,
        `${String(chapterNum).padStart(2, '0')}.md`,
      );

      if (resume) {
        try {
          await import('node:fs/promises').then(fs => fs.access(chapterPath));
          console.log(`[SKIP] Chapter ${chapterNum} (already processed)`);
          skippedCount++;
          const existingConcepts = await this.writer.extractConceptsFromChapter(
            bookName,
            chapterNum,
          );
          existingConcepts.forEach(c => allConcepts.add(c));
          continue;
        } catch {
          // File doesn't exist, process it
        }
      }

      console.log(`[LLM] Chapter ${chapterNum}`);

      const result = await this.llmAnalyzer.analyze(chapter);

      await this.writer.writeChapter(bookName, project, chapterNum, result);

      for (const concept of result.concepts) {
        const rec = concept as unknown as { name?: string; title?: string; term?: string };
        const conceptName = rec.name || rec.title || rec.term || '';

        if (!conceptName) {
          console.warn(
            `[WARN] Chapter ${chapterNum}: Skipping concept without recognizable name. Keys: ${Object.keys(concept).join(', ')}`,
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

        await this.knowledgeStore.registerConcept(name, bookName);

        await this.writer.updateConcept(name, description, bookName);
      }
    }

    if (resume && skippedCount > 0) {
      console.log(`[INFO] Skipped ${skippedCount} already-processed chapters`);
    }

    await this.knowledgeStore.registerBook(bookName, project);

    await this.writer.writeBookIndex(bookName, chapters.length, allConcepts);

    await this.writer.writeGlobalMoc();

    console.log('[DONE]');
  }
}
