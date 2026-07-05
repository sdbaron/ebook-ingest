import fs from 'node:fs/promises';
import * as cheerio from 'cheerio';

/**
 * Extract clean text blocks from HTML files or URLs.
 *
 * Removes boilerplate (nav, footer, scripts, styles) and splits
 * the remaining content into manageable text blocks.
 */
export class HtmlExtractor {
  /**
   * Collapse whitespace and trim.
   */
  static cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Remove boilerplate elements from a cheerio document in-place.
   */
  static removeBoilerplate($: cheerio.CheerioAPI): void {
    // Remove non-content elements
    const boilerplateSelectors = [
      'script',
      'style',
      'nav',
      'footer',
      'header',
      'aside',
      'form',
      'noscript',
      '[role="navigation"]',
      '[role="banner"]',
      '[role="contentinfo"]',
      '.sidebar',
      '.menu',
      '.comment',
      '.advertisement',
      '.cookie',
      '.popup',
    ];

    for (const selector of boilerplateSelectors) {
      $(selector).remove();
    }
  }

  /**
   * Extract text blocks from an HTML file or URL.
   *
   * Source is auto-detected: strings starting with "http" are treated as URLs,
   * everything else as local file paths.
   *
   * @param source   File path or URL (detected by http/https prefix)
   * @param minChars Minimum characters per block (default: 200)
   * @returns Array of text blocks
   */
  static async extract(source: string, minChars: number = 200): Promise<string[]> {
    let html: string;

    if (source.startsWith('http://') || source.startsWith('https://')) {
      try {
        const response = await fetch(source);
        if (!response.ok) {
          console.warn(`[WARN] HTTP ${response.status} for "${source}"`);
          return [];
        }
        html = await response.text();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[WARN] Failed to fetch "${source}": ${message}`);
        return [];
      }
    } else {
      try {
        html = await fs.readFile(source, 'utf-8');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[WARN] Cannot read HTML file "${source}": ${message}`);
        return [];
      }
    }

    const $ = cheerio.load(html);
    HtmlExtractor.removeBoilerplate($);

    const bodyText = HtmlExtractor.cleanText($('body').text() || $.text());

    // Additional text-based boilerplate removal
    const cleanedText = HtmlExtractor.removeTextBoilerplate(bodyText);

    // Split into blocks at sentence boundaries
    const blocks = HtmlExtractor.splitIntoBlocks(cleanedText, minChars);

    return blocks;
  }

  /**
   * Remove boilerplate text patterns (copyright, cookie notices, etc.).
   */
  private static removeTextBoilerplate(text: string): string {
    const patterns = [
      /\bcopyright\s*©?\s*\d{4}/gi,
      /\ball rights reserved\b/gi,
      /\bterms (?:of|and) (?:service|use|conditions)\b/gi,
      /\bprivacy policy\b/gi,
      /\bcookie (?:policy|consent|notice)\b/gi,
      /\bsubscribe to our newsletter\b/gi,
      /\bclick here to (?:accept|agree|subscribe)\b/gi,
      /\bwe use cookies\b/gi,
      /\bsign (?:up|in) (?:for|to)\b/gi,
    ];

    let result = text;
    for (const pattern of patterns) {
      result = result.replace(pattern, '');
    }
    return result;
  }

  /**
   * Split cleaned text into blocks of at least `minChars` characters.
   * Splits at sentence boundaries (., !, ?) and groups sentences
   * until the minimum length is reached.
   */
  private static splitIntoBlocks(text: string, minChars: number): string[] {
    const blocks: string[] = [];

    // Split into sentences
    const sentences = text.split(/(?<=[.!?])\s+/);
    let currentBlock = '';

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;

      currentBlock += (currentBlock ? ' ' : '') + trimmed;

      if (currentBlock.length >= minChars) {
        blocks.push(currentBlock.trim());
        currentBlock = '';
      }
    }

    // Don't lose the last partial block
    if (currentBlock.trim().length > 0) {
      // Prepend to previous block if it exists
      if (blocks.length > 0) {
        blocks[blocks.length - 1] += ' ' + currentBlock.trim();
      } else {
        blocks.push(currentBlock.trim());
      }
    }

    return blocks;
  }
}
