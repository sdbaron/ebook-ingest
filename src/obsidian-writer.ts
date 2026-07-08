import fs from 'node:fs/promises';
import path from 'node:path';
import { ConceptNormalizer } from './concept-normalizer.js';
import { ChapterAnalysis, ConceptEntry } from './llm-analyzer.js';
import { RegistryManager } from './registry-manager.js';

/**
 * Write Obsidian-compatible markdown files for the knowledge base.
 */
export class ObsidianWriter {
  private vault: string;
  /** @deprecated Use sourcesDir */
  private booksDir: string;
  private sourcesDir: string;
  private conceptsDir: string;
  private mocDir: string;
  private conceptRegistryPath: string;

  constructor(
    vault: string,
    booksDir: string,
    sourcesDir: string,
    conceptsDir: string,
    mocDir: string,
    conceptRegistryPath: string,
  ) {
    this.vault = vault;
    this.booksDir = booksDir;
    this.sourcesDir = sourcesDir;
    this.conceptsDir = conceptsDir;
    this.mocDir = mocDir;
    this.conceptRegistryPath = conceptRegistryPath;
  }

  /**
   * Write a source block markdown file (new method).
   */
  async writeSourceBlock(
    sourceName: string,
    project: string,
    blockNum: number,
    blockData: ChapterAnalysis,
    sourceType: string = 'epub',
  ): Promise<void> {
    const sourceDir = path.resolve(this.vault, this.sourcesDir, sourceName);
    await fs.mkdir(sourceDir, { recursive: true });

    const concepts = blockData.concepts
      .map((c: ConceptEntry) => {
        const rec = c as unknown as Record<string, string>;
        const name = c.name || rec.title || rec.term || '';
        if (!name) {
          console.warn(
            `[WARN] Skipping concept without recognizable name key. Keys: ${Object.keys(c).join(', ')}`,
          );
          return null;
        }
        return ConceptNormalizer.normalize(name);
      })
      .filter((c): c is string => c !== null);

    const links = concepts.map(c => `- [[${c}]]`).join('\n');

    const md = `---
type: source_block
source: ${sourceName}
source_type: ${sourceType}
project: ${project}
---

# ${blockData.title}

## Summary

${blockData.summary}

## Concepts

${links}
`;

    const filePath = path.resolve(sourceDir, `${String(blockNum).padStart(2, '0')}.md`);
    await fs.writeFile(filePath, md, 'utf-8');
  }

  /**
   * Write a source index with block listing and concept links (new method).
   */
  async writeSourceIndex(
    sourceName: string,
    blockCount: number,
    concepts: Set<string>,
    sourceType: string = 'epub',
  ): Promise<void> {
    const sourceDir = path.resolve(this.vault, this.sourcesDir, sourceName);
    await fs.mkdir(sourceDir, { recursive: true });

    const blocks = Array.from(
      { length: blockCount },
      (_, i) => `- [[${String(i + 1).padStart(2, '0')}]]`,
    ).join('\n');

    const conceptLinks = [...concepts]
      .sort()
      .map(c => `- [[${c}]]`)
      .join('\n');

    const md = `---
type: source
source_type: ${sourceType}
---

# ${sourceName}

## Blocks

${blocks}

## Concepts

${conceptLinks}
`;

    const filePath = path.resolve(sourceDir, 'index.md');
    await fs.writeFile(filePath, md, 'utf-8');
  }

  /** @deprecated Use writeSourceBlock */
  async writeChapter(
    bookName: string,
    project: string,
    chapterNum: number,
    chapterData: ChapterAnalysis,
  ): Promise<void> {
    return this.writeSourceBlock(bookName, project, chapterNum, chapterData, 'epub');
  }

  /**
   * Update or create a concept note.
   */
  async updateConcept(conceptName: string, description: string, sourceName: string): Promise<void> {
    const conceptsDirPath = path.resolve(this.vault, this.conceptsDir);
    await fs.mkdir(conceptsDirPath, { recursive: true });

    const filePath = path.resolve(conceptsDirPath, `${conceptName}.md`);

    const sources = new Set<string>();
    sources.add(sourceName);

    try {
      const existingContent = await fs.readFile(filePath, 'utf-8');
      const matches = existingContent.matchAll(/\[\[(.*?)\]\]/g);
      for (const m of matches) {
        sources.add(m[1]);
      }
    } catch {
      // File doesn't exist yet — that's fine
    }

    const sourcesSection = [...sources]
      .sort()
      .map(s => `- [[${s}]]`)
      .join('\n');

    const md = `---
type: concept
---

# ${conceptName}

## Definition

${description}

## Mentioned in

${sourcesSection}
`;

    await fs.writeFile(filePath, md, 'utf-8');
  }

  /** @deprecated Use writeSourceIndex */
  async writeBookIndex(
    bookName: string,
    chapterCount: number,
    concepts: Set<string>,
  ): Promise<void> {
    return this.writeSourceIndex(bookName, chapterCount, concepts, 'epub');
  }

  /**
   * Extract concept names from an existing source block file.
   */
  async extractConceptsFromChapter(sourceName: string, blockNum: number): Promise<Set<string>> {
    // Try new sourcesDir first, fall back to booksDir
    for (const dir of [this.sourcesDir, this.booksDir]) {
      const filePath = path.resolve(
        this.vault,
        dir,
        sourceName,
        `${String(blockNum).padStart(2, '0')}.md`,
      );

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const conceptsMatch = content.match(/## Concepts\s*\n(.*?)(?:\n##|\Z)/s);
        if (!conceptsMatch) continue;

        const concepts = new Set<string>();
        const linkRegex = /\[\[(.*?)\]\]/g;
        let match: RegExpExecArray | null;
        while ((match = linkRegex.exec(conceptsMatch[1])) !== null) {
          concepts.add(match[1]);
        }
        return concepts;
      } catch {
        // Try next directory
      }
    }
    return new Set();
  }

  /**
   * Write the global Map of Content.
   */
  async writeGlobalMoc(): Promise<void> {
    const registry = await RegistryManager.load<Record<string, { books?: string[]; sources?: string[] }>>(
      this.conceptRegistryPath,
    );

    const concepts = Object.keys(registry).sort();
    const links = concepts.map(c => `- [[${c}]]`).join('\n');

    const mocDirPath = path.resolve(this.vault, this.mocDir);
    await fs.mkdir(mocDirPath, { recursive: true });

    const md = `# Software Engineering

## Concepts

${links}
`;

    const filePath = path.resolve(mocDirPath, 'Software Engineering.md');
    await fs.writeFile(filePath, md, 'utf-8');
  }

  // ── Image helpers ───────────────────────────────────────────────────

  /**
   * Build an Obsidian embed link for an extracted image.
   *
   * @returns e.g. "![[06_attachments/clean-architecture/fig-3-1.png]]"
   */
  static imageEmbed(
    attachmentsDir: string,
    sourceName: string,
    fileName: string,
  ): string {
    return `![[${attachmentsDir}/${sourceName}/${fileName}]]`;
  }

  /**
   * Append an `## Images` section to the source index file.
   * Creates the section only when image embeds are provided.
   */
  async appendImagesToSourceIndex(
    sourceName: string,
    imageEmbeds: string[],
  ): Promise<void> {
    if (imageEmbeds.length === 0) return;

    const indexPath = path.resolve(
      this.vault,
      this.sourcesDir,
      sourceName,
      'index.md',
    );

    const section = [
      '',
      '## Images',
      '',
      ...imageEmbeds,
      '',
    ].join('\n');

    try {
      await fs.appendFile(indexPath, section, 'utf-8');
    } catch (err) {
      console.warn(
        `[WARN] Failed to append images to source index "${sourceName}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
