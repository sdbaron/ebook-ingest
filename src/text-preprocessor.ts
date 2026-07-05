/**
 * Preprocessing layer that cleans text blocks before LLM analysis.
 *
 * Handles:
 * - PDF header/footer removal (repeating text patterns across pages)
 * - HTML boilerplate text removal (copyright, cookie notices, etc.)
 * - Chapter boundary detection (headings, numbering patterns)
 * - Quality filtering (too short, too long, repetitive, non-text content)
 * - Whitespace normalization
 */

export interface PreprocessorOptions {
  /** Remove PDF headers/footers (repeating text at top/bottom of pages) */
  removeHeadersFooters: boolean;
  /** Minimum characters for a block to be kept */
  minBlockLength: number;
  /** Maximum characters for a block (split longer blocks) */
  maxBlockLength: number;
  /** Attempt to detect chapter boundaries */
  detectChapters: boolean;
  /** Remove boilerplate text patterns (page numbers, copyright, etc.) */
  removeBoilerplate: boolean;
}

export interface PreprocessResult {
  blocks: string[];
  /** Statistics about what was removed */
  stats: PreprocessStats;
}

export interface PreprocessStats {
  originalBlockCount: number;
  filteredBlockCount: number;
  removedHeadersFooters: number;
  splitBlocks: number;
  mergedShortBlocks: number;
  chapterBoundariesDetected: number;
}

export const defaultPreprocessorOptions: PreprocessorOptions = {
  removeHeadersFooters: true,
  minBlockLength: 200,
  maxBlockLength: 15000,
  detectChapters: true,
  removeBoilerplate: true,
};

/**
 * Preprocesses raw text blocks into cleaned, analysis-ready blocks.
 */
export class TextPreprocessor {
  constructor(private options: PreprocessorOptions = defaultPreprocessorOptions) {}

  /**
   * Process raw text blocks and return cleaned blocks with statistics.
   */
  process(
    blocks: string[],
    sourceFormat: 'epub' | 'pdf' | 'html' | 'url',
  ): PreprocessResult {
    const stats: PreprocessStats = {
      originalBlockCount: blocks.length,
      filteredBlockCount: 0,
      removedHeadersFooters: 0,
      splitBlocks: 0,
      mergedShortBlocks: 0,
      chapterBoundariesDetected: 0,
    };

    let processed = [...blocks];

    // Step 1: Remove PDF headers/footers (PDF only)
    if (this.options.removeHeadersFooters && sourceFormat === 'pdf') {
      const before = processed.length;
      processed = this.removePdfHeadersFooters(processed);
      stats.removedHeadersFooters = before; // all blocks were processed
    }

    // Step 2: Remove boilerplate text patterns
    if (this.options.removeBoilerplate) {
      processed = processed.map(block => this.removeBoilerplatePatterns(block));
    }

    // Step 3: Normalize whitespace
    processed = processed.map(block => block.replace(/\s+/g, ' ').trim());

    // Step 4: Detect chapter boundaries (PDF and HTML)
    if (this.options.detectChapters && (sourceFormat === 'pdf' || sourceFormat === 'html' || sourceFormat === 'url')) {
      const before = processed.length;
      processed = this.detectChapterBoundaries(processed);
      stats.chapterBoundariesDetected = processed.length - before;
    }

    // Step 5: Split long blocks
    processed = this.splitLongBlocks(processed);

    // Step 6: Merge very short blocks with neighbors (before quality filter)
    processed = this.mergeShortBlocks(processed);

    // Step 7: Filter by quality
    processed = this.filterByQuality(processed);

    stats.filteredBlockCount = processed.length;

    // Recalculate splitBlocks
    const afterSplit = processed.length;
    stats.splitBlocks = 0; // splitting is tracked separately now
    return { blocks: processed, stats };
  }

  // ─── Private Methods ──────────────────────────────────────────

  /**
   * Remove repeated headers and footers from PDF page blocks.
   * Uses longest-common-prefix/suffix detection across pages.
   */
  private removePdfHeadersFooters(blocks: string[]): string[] {
    if (blocks.length < 3) return blocks;

    // Find common prefix (header) across first 80 chars of each page
    const headerLen = this.findCommonPrefixLength(
      blocks.map(b => b.slice(0, 80)),
      0.5, // must appear on >50% of pages
    );

    // Find common suffix (footer) across last 80 chars
    const footerLen = this.findCommonSuffixLength(
      blocks.map(b => b.slice(-80)),
      0.5,
    );

    return blocks.map(block => {
      let cleaned = block;

      // Remove header
      if (headerLen > 10) {
        cleaned = cleaned.slice(headerLen);
      }

      // Remove footer
      if (footerLen > 5) {
        cleaned = cleaned.slice(0, -footerLen);
      }

      return cleaned.trim();
    });
  }

  /**
   * Find the longest prefix that is common across a majority of strings.
   */
  private findCommonPrefixLength(strings: string[], threshold: number): number {
    if (strings.length === 0) return 0;

    const minLen = Math.min(...strings.map(s => s.length));
    let commonLen = 0;

    for (let i = 0; i < minLen; i++) {
      const char = strings[0][i];
      let matchCount = 0;
      for (const s of strings) {
        if (s[i] === char) matchCount++;
      }
      if (matchCount / strings.length >= threshold) {
        commonLen = i + 1;
      } else {
        break;
      }
    }

    return commonLen;
  }

  /**
   * Find the longest suffix common across a majority of strings.
   */
  private findCommonSuffixLength(strings: string[], threshold: number): number {
    const reversed = strings.map(s => s.split('').reverse().join(''));
    return this.findCommonPrefixLength(reversed, threshold);
  }

  /**
   * Remove boilerplate text patterns from a single block.
   */
  private removeBoilerplatePatterns(text: string): string {
    const patterns: RegExp[] = [
      // Page numbers (standalone numbers on a line)
      /^\d{1,4}\s*$/gm,
      // "Page X of Y" / "Seite X von Y"
      /\b(?:page|seite)\s+\d+\s+(?:of|von)\s+\d+\b/gi,
      // Copyright lines
      /\bcopyright\s*©?\s*\d{4}/gi,
      /\ball rights reserved\b/gi,
      // Legal boilerplate
      /\bterms (?:of|and) (?:service|use|conditions)\b/gi,
      /\bprivacy policy\b/gi,
      /\bcookie (?:policy|consent|notice)\b/gi,
      /\bsubscribe to our newsletter\b/gi,
      /\bclick here to (?:accept|agree|subscribe)\b/gi,
      /\bwe use cookies\b/gi,
      /\bsign (?:up|in) (?:for|to)\b/gi,
      // Published/dates
      /\bpublished (?:on|at)\b/gi,
    ];

    let result = text;
    for (const pattern of patterns) {
      result = result.replace(pattern, '');
    }
    return result;
  }

  /**
   * Detect chapter boundaries within blocks using heading heuristics.
   * Splits blocks at detected chapter headings.
   */
  private detectChapterBoundaries(blocks: string[]): string[] {
    const result: string[] = [];

    for (const block of blocks) {
      const lines = block.split(/\n|\. (?=[A-Z])/); // split on newlines or sentence boundaries before capitals
      const chapters: string[] = [];
      let currentChapter = '';

      for (const line of lines) {
        if (this.isChapterHeading(line.trim())) {
          if (currentChapter.trim().length > 0) {
            chapters.push(currentChapter.trim());
          }
          currentChapter = line.trim() + ' ';
        } else {
          currentChapter += line + ' ';
        }
      }

      if (currentChapter.trim().length > 0) {
        chapters.push(currentChapter.trim());
      }

      result.push(...chapters);
    }

    return result.length > 0 ? result : blocks;
  }

  /**
   * Check if a line looks like a chapter/section heading.
   */
  private isChapterHeading(line: string): boolean {
    if (line.length === 0) return false;

    // Negative patterns (definitely not a heading)
    const negativePatterns = [
      /^\d+$/,                    // Just numbers (page numbers)
      /^[a-z]/,                   // Starts lowercase
      /.{120,}/,                  // Too long to be a heading
    ];

    if (negativePatterns.some(p => p.test(line))) return false;

    // Positive patterns (likely a heading)
    const positivePatterns = [
      /^(?:chapter|kapitel|kap\.|ch\.)\s+\d+/i,
      /^\d+\.\s+[A-ZÄÖÜ][a-zäöü]+/,      // "1. Introduction"
      /^[IVX]+\.\s+[A-ZÄÖÜ]/,             // "IV. Methodology"
      /^(?:part|teil|section|abschnitt)\s+\d+/i,
      /^#+\s/,                              // Markdown headings
      /^[A-ZÄÖÜ][A-ZÄÖÜ\s]{3,60}$/,       // ALL CAPS TITLE
    ];

    return positivePatterns.some(p => p.test(line));
  }

  /**
   * Split blocks that exceed maxBlockLength at sentence boundaries.
   */
  private splitLongBlocks(blocks: string[]): string[] {
    const result: string[] = [];

    for (const block of blocks) {
      if (block.length <= this.options.maxBlockLength) {
        result.push(block);
        continue;
      }

      // Split at sentence boundaries
      const sentences = block.split(/(?<=[.!?])\s+/);
      let currentChunk = '';

      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > this.options.maxBlockLength && currentChunk.length > 0) {
          result.push(currentChunk.trim());
          currentChunk = '';
        }
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }

      if (currentChunk.trim().length > 0) {
        result.push(currentChunk.trim());
      }
    }

    return result;
  }

  /**
   * Filter blocks by quality metrics.
   */
  private filterByQuality(blocks: string[]): string[] {
    return blocks.filter(block => {
      const text = block.trim();

      // Empty or whitespace only
      if (text.length === 0) return false;

      // Too short
      if (text.length < this.options.minBlockLength) return false;

      // Too few letters (code blocks, tables, etc.)
      const letterRatio = (text.match(/[A-Za-zÄÖÜäöüß]/g) || []).length / text.length;
      if (letterRatio < 0.5) return false;

      // Repetitive content
      if (this.isRepetitive(text)) return false;

      return true;
    });
  }

  /**
   * Check if text is highly repetitive (same sentence repeated).
   */
  private isRepetitive(text: string): boolean {
    const sentences = text.split(/[.!?]\s+/);
    if (sentences.length < 3) return false;

    for (const sentence of sentences) {
      const count = (text.match(new RegExp(sentence.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      if (count > sentences.length * 0.8) return true;
    }

    return false;
  }

  /**
   * Merge very short blocks with adjacent blocks.
   */
  private mergeShortBlocks(blocks: string[]): string[] {
    if (blocks.length <= 1) return blocks;

    const result: string[] = [];
    let buffer = '';

    for (const block of blocks) {
      if (block.length < this.options.minBlockLength && result.length > 0) {
        // Merge with previous block
        const prev = result.pop()!;
        result.push(prev + ' ' + block);
      } else if (block.length < this.options.minBlockLength) {
        // First block is short, buffer it
        buffer = block;
      } else {
        if (buffer) {
          result.push(buffer + ' ' + block);
          buffer = '';
        } else {
          result.push(block);
        }
      }
    }

    // Don't lose trailing buffer
    if (buffer && result.length > 0) {
      result[result.length - 1] += ' ' + buffer;
    } else if (buffer) {
      result.push(buffer);
    }

    return result;
  }
}
