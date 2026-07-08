import path from 'node:path';
import { EbookIngestConfig } from './config.js';
import { UniversalExtractor } from './universal-extractor.js';
import type { SourceFormat } from './universal-extractor.js';
import { TextPreprocessor } from './text-preprocessor.js';
import { LLMAnalyzer, ConceptEntry } from './llm-analyzer.js';
import { ConceptNormalizer } from './concept-normalizer.js';
import { RegistryManager } from './registry-manager.js';
import { KnowledgeStore } from './knowledge-store.js';
import { ObsidianWriter } from './obsidian-writer.js';
import { EmbeddingGenerator } from './embedding-generator.js';
import { VectorStore, buildDocId } from './vector-store.js';
import { FrontmatterValidator } from './frontmatter-validator.js';

/**
 * Main pipeline: Source → Preprocess → LLM analysis → Obsidian vault.
 */
export class WikiPipeline {
  private config: EbookIngestConfig;
  private writer: ObsidianWriter;
  private knowledgeStore: KnowledgeStore;
  private llmAnalyzer: LLMAnalyzer;
  private extractor: UniversalExtractor;
  private embeddingGenerator: EmbeddingGenerator;
  private vectorStore: VectorStore;

  constructor(config: EbookIngestConfig) {
    this.config = config;
    this.llmAnalyzer = new LLMAnalyzer(config.model);
    this.embeddingGenerator = new EmbeddingGenerator();
    this.vectorStore = new VectorStore();

    const conceptRegPath = path.resolve(config.vault, config.conceptRegistry);
    const sourceRegPath = path.resolve(config.vault, config.sourceRegistry);

    this.writer = new ObsidianWriter(
      config.vault,
      config.booksDir,
      config.sourcesDir,
      config.conceptsDir,
      config.mocDir,
      conceptRegPath,
      config.wikiStandard,
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

    // Validate frontmatter against WIKI_CONTENT_STANDARD.md
    if (this.config.wikiStandard.enabled) {
      try {
        const indexPath = path.resolve(
          this.config.vault,
          this.config.sourcesDir,
          sourceName,
          'index.md',
        );
        const content = await (
          await import('node:fs/promises')
        ).readFile(indexPath, 'utf-8');
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          // Quick parse: split into key: value pairs
          const fm: Record<string, unknown> = {};
          for (const line of fmMatch[1].split('\n')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const key = line.slice(0, colonIdx).trim();
            let value: unknown = line.slice(colonIdx + 1).trim();
            if (typeof value === 'string') {
              value = value.replace(/^["']|["']$/g, '');
            }
            fm[key] = value;
          }
          const result = FrontmatterValidator.validate(fm);
          if (!result.valid) {
            console.warn(
              `[VALIDATE] Source index "${sourceName}" has frontmatter issues:` +
              `\n  ${result.errors.join('\n  ')}`,
            );
          }
        }
      } catch {
        // Best-effort — don't crash the pipeline
      }
    }

    // Extract and copy images from the source
    const attachmentsBase = path.resolve(
      this.config.vault,
      this.config.attachmentsDir,
    );
    const imageTargetDir = path.join(attachmentsBase, sourceName);
    const images = await this.extractor.extractImages(
      sourcePath,
      imageTargetDir,
    );

    if (images.length > 0) {
      console.log(
        `[IMAGES] Extracted ${images.length} image(s) → ${imageTargetDir}`,
      );
      const imageEmbeds = images.map(
        img =>
          ObsidianWriter.imageEmbed(
            this.config.attachmentsDir,
            sourceName,
            img.fileName,
          ),
      );
      await this.writer.appendImagesToSourceIndex(
        sourceName,
        imageEmbeds,
      );
    }

    await this.writer.writeGlobalMoc();

    // Generate and store embeddings (if ChromaDB is available)
    await this.indexVectors(sourceName, blocks, extractionResult.format);

    console.log('[DONE]');
  }

  /**
   * Generate embeddings and store them in ChromaDB.
   */
  private async indexVectors(
    sourceName: string,
    blocks: string[],
    sourceFormat: SourceFormat,
  ): Promise<void> {
    await this.vectorStore.connect();

    if (!this.vectorStore.isConnected()) return;

    console.log(`[VECTOR] Generating embeddings for ${sourceName}...`);

    const embedResults = await this.embeddingGenerator.embed(
      blocks,
      blocks.map((_, i) => ({
        sourceName,
        blockIndex: i + 1,
        sourceFormat,
        vaultPath: `${sourceName}/${String(i + 1).padStart(2, '0')}.md`,
      })),
    );

    if (embedResults.length > 0) {
      await this.vectorStore.addDocuments(
        embedResults.map(r => ({
          id: buildDocId(sourceName, r.metadata.blockIndex),
          text: r.text,
          embedding: r.embedding,
          metadata: {
            sourceName: r.metadata.sourceName,
            blockIndex: r.metadata.blockIndex,
            sourceFormat: r.metadata.sourceFormat,
            vaultPath: r.metadata.vaultPath || '',
          },
        })),
      );
    }
  }

  /**
   * Get the vector store for external use (search, reindex).
   */
  getVectorStore(): VectorStore {
    return this.vectorStore;
  }

  /**
   * Get the embedding generator for external use.
   */
  getEmbeddingGenerator(): EmbeddingGenerator {
    return this.embeddingGenerator;
  }
}
