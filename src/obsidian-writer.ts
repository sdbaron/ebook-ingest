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
  private booksDir: string;
  private conceptsDir: string;
  private mocDir: string;
  private conceptRegistryPath: string;

  constructor(
    vault: string,
    booksDir: string,
    conceptsDir: string,
    mocDir: string,
    conceptRegistryPath: string,
  ) {
    this.vault = vault;
    this.booksDir = booksDir;
    this.conceptsDir = conceptsDir;
    this.mocDir = mocDir;
    this.conceptRegistryPath = conceptRegistryPath;
  }

  /**
   * Write a chapter markdown file.
   */
  async writeChapter(
    bookName: string,
    project: string,
    chapterNum: number,
    chapterData: ChapterAnalysis,
  ): Promise<void> {
    const bookDir = path.resolve(this.vault, this.booksDir, bookName);
    await fs.mkdir(bookDir, { recursive: true });

    const concepts = chapterData.concepts
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
type: chapter
book: ${bookName}
project: ${project}
---

# ${chapterData.title}

## Summary

${chapterData.summary}

## Concepts

${links}
`;

    const filePath = path.resolve(bookDir, `${String(chapterNum).padStart(2, '0')}.md`);
    await fs.writeFile(filePath, md, 'utf-8');
  }

  /**
   * Update or create a concept note.
   */
  async updateConcept(conceptName: string, description: string, bookName: string): Promise<void> {
    const conceptsDirPath = path.resolve(this.vault, this.conceptsDir);
    await fs.mkdir(conceptsDirPath, { recursive: true });

    const filePath = path.resolve(conceptsDirPath, `${conceptName}.md`);

    const books = new Set<string>();
    books.add(bookName);

    try {
      const existingContent = await fs.readFile(filePath, 'utf-8');
      const matches = existingContent.matchAll(/\[\[(.*?)\]\]/g);
      for (const m of matches) {
        books.add(m[1]);
      }
    } catch {
      // File doesn't exist yet — that's fine
    }

    const booksSection = [...books]
      .sort()
      .map(b => `- [[${b}]]`)
      .join('\n');

    const md = `---
type: concept
---

# ${conceptName}

## Definition

${description}

## Mentioned in

${booksSection}
`;

    await fs.writeFile(filePath, md, 'utf-8');
  }

  /**
   * Write the book index with chapter listing and concept links.
   */
  async writeBookIndex(
    bookName: string,
    chapterCount: number,
    concepts: Set<string>,
  ): Promise<void> {
    const bookDir = path.resolve(this.vault, this.booksDir, bookName);
    await fs.mkdir(bookDir, { recursive: true });

    const chapters = Array.from(
      { length: chapterCount },
      (_, i) => `- [[${String(i + 1).padStart(2, '0')}]]`,
    ).join('\n');

    const conceptLinks = [...concepts]
      .sort()
      .map(c => `- [[${c}]]`)
      .join('\n');

    const md = `---
type: book
---

# ${bookName}

## Chapters

${chapters}

## Concepts

${conceptLinks}
`;

    const filePath = path.resolve(bookDir, 'index.md');
    await fs.writeFile(filePath, md, 'utf-8');
  }

  /**
   * Extract concept names from an existing chapter file.
   */
  async extractConceptsFromChapter(bookName: string, chapterNum: number): Promise<Set<string>> {
    const filePath = path.resolve(
      this.vault,
      this.booksDir,
      bookName,
      `${String(chapterNum).padStart(2, '0')}.md`,
    );

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const conceptsMatch = content.match(/## Concepts\s*\n(.*?)(?:\n##|\Z)/s);
      if (!conceptsMatch) return new Set();

      const concepts = new Set<string>();
      const linkRegex = /\[\[(.*?)\]\]/g;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(conceptsMatch[1])) !== null) {
        concepts.add(match[1]);
      }
      return concepts;
    } catch {
      return new Set();
    }
  }

  /**
   * Write the global Map of Content.
   */
  async writeGlobalMoc(): Promise<void> {
    const registry = await RegistryManager.load<Record<string, { books: string[] }>>(
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
}
