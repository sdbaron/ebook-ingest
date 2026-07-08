import fs from 'node:fs/promises';
import path from 'node:path';
import { ConceptNormalizer } from './concept-normalizer.js';
import { ChapterAnalysis, ConceptEntry } from './llm-analyzer.js';
import { RegistryManager } from './registry-manager.js';
import type { WikiNoteType, WikiStandardConfig } from './config.js';

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
  private wikiStandard: WikiStandardConfig;

  constructor(
    vault: string,
    booksDir: string,
    sourcesDir: string,
    conceptsDir: string,
    mocDir: string,
    conceptRegistryPath: string,
    wikiStandard: WikiStandardConfig,
  ) {
    this.vault = vault;
    this.booksDir = booksDir;
    this.sourcesDir = sourcesDir;
    this.conceptsDir = conceptsDir;
    this.mocDir = mocDir;
    this.conceptRegistryPath = conceptRegistryPath;
    this.wikiStandard = wikiStandard;
  }

  /**
   * Write a source block markdown file.
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

    const wikiType: WikiNoteType =
      (this.wikiStandard.blockTypeMapping[sourceType] as WikiNoteType) ?? 'book';
    const domain = project || this.wikiStandard.defaultDomain;
    const today = new Date().toISOString().slice(0, 10);

    const frontmatter = ObsidianWriter.buildFrontmatter({
      title: blockData.title,
      wikiType,
      domain,
      owner: this.wikiStandard.defaultOwner,
      created: today,
      updated: today,
      tags: [sourceType, domain],
      aliases: [],
      extra: { source: sourceName, source_type: sourceType, project },
    });

    const md = `${frontmatter}

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
   * Write a source index with block listing and concept links.
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

    const today = new Date().toISOString().slice(0, 10);
    const domain = this.wikiStandard.defaultDomain;

    const frontmatter = ObsidianWriter.buildFrontmatter({
      title: sourceName,
      wikiType: 'index',
      domain,
      owner: this.wikiStandard.defaultOwner,
      created: today,
      updated: today,
      tags: [sourceType, domain],
      aliases: [],
      extra: { source_type: sourceType },
    });

    const md = `${frontmatter}

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
  async updateConcept(
    conceptName: string,
    description: string,
    sourceName: string,
  ): Promise<void> {
    const conceptsDirPath = path.resolve(this.vault, this.conceptsDir);
    await fs.mkdir(conceptsDirPath, { recursive: true });

    const filePath = path.resolve(conceptsDirPath, `${conceptName}.md`);

    const sources = new Set<string>();
    sources.add(sourceName);

    // Collect existing sources + aliases from registry
    let aliases: string[] = [];
    try {
      const registry = await RegistryManager.load<
        Record<string, { sources?: string[]; aliases?: string[] }>
      >(this.conceptRegistryPath);
      const entry = registry[conceptName];
      if (entry) {
        if (entry.aliases) aliases = entry.aliases;
        if (entry.sources) entry.sources.forEach(s => sources.add(s));
      }
    } catch { /* registry may not exist yet */ }

    // Also collect from existing file content
    try {
      const existingContent = await fs.readFile(filePath, 'utf-8');
      const matches = existingContent.matchAll(/\[\[(.*?)\]\]/g);
      for (const m of matches) {
        sources.add(m[1]);
      }
    } catch {
      // File doesn't exist yet — fine
    }

    const sourcesSection = [...sources]
      .sort()
      .map(s => `- [[${s}]]`)
      .join('\n');

    const sourceWikilinks = [...sources].map(s => `[[${s}]]`);
    const today = new Date().toISOString().slice(0, 10);

    const frontmatter = ObsidianWriter.buildFrontmatter({
      title: conceptName.replace(/_/g, ' '),
      wikiType: 'concept',
      domain: this.wikiStandard.defaultDomain,
      owner: this.wikiStandard.defaultOwner,
      created: today,
      updated: today,
      tags: ['concept', this.wikiStandard.defaultDomain],
      aliases,
      sources: sourceWikilinks,
    });

    const md = `${frontmatter}

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

  // ── WIKI_CONTENT_STANDARD.md frontmatter builder ─────────────────────

  /**
   * Input for building a standard-compliant frontmatter block.
   */
  static buildFrontmatter(input: {
    title: string;
    wikiType: WikiNoteType;
    domain: string;
    owner: string;
    created: string;
    updated: string;
    tags: string[];
    aliases: string[];
    sources?: string[];
    related?: string[];
    extra?: Record<string, string>;
  }): string {
    const q = ObsidianWriter.yamlQuote;

    const lines = [
      '---',
      `title: ${q(input.title)}`,
      `type: ${input.wikiType}`,
      `domain: ${q(input.domain)}`,
      `owner: ${q(input.owner)}`,
      `created: "${input.created}"`,
      `updated: "${input.updated}"`,
      `updated_at: "${input.updated}"`,
    ];

    // tags: YAML flow array if short, block array if many
    if (input.tags.length === 1) {
      lines.push(`tags: [${input.tags[0]}]`);
    } else {
      lines.push('tags:');
      for (const t of input.tags) {
        lines.push(`  - ${t}`);
      }
    }

    // aliases
    if (input.aliases.length === 0) {
      lines.push('aliases: []');
    } else {
      lines.push('aliases:');
      for (const a of input.aliases) {
        lines.push(`  - ${q(a)}`);
      }
    }

    // sources (optional)
    if (input.sources && input.sources.length > 0) {
      lines.push('sources:');
      for (const s of input.sources) {
        lines.push(`  - ${q(s)}`);
      }
    } else if (input.wikiType === 'concept') {
      lines.push('sources: []');
    }

    // related (optional)
    if (input.related && input.related.length > 0) {
      lines.push('related:');
      for (const r of input.related) {
        lines.push(`  - ${q(r)}`);
      }
    }

    // Extra fields (e.g. source, source_type, project)
    if (input.extra) {
      for (const [key, value] of Object.entries(input.extra)) {
        if (key === 'project' && !value.startsWith('"')) {
          lines.push(`${key}: ${q(value)}`);
        } else {
          lines.push(`${key}: ${q(value)}`);
        }
      }
    }

    lines.push('---');
    return lines.join('\n');
  }

  /**
   * Quote a YAML scalar value if it contains characters that
   * would break the YAML parser (colon, hash, quotes, newlines)
   * or if the value has leading/trailing whitespace.
   */
  private static yamlQuote(value: string): string {
    if (/[:#\"'\n]/.test(value) || value !== value.trim()) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
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
