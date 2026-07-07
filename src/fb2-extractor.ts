import fs from 'node:fs/promises';
import * as cheerio from 'cheerio';

/**
 * Extract clean text blocks from FictionBook 2 (.fb2) files.
 *
 * FB2 is an XML-based e-book format popular in Russian-speaking regions.
 * This extractor uses cheerio in xmlMode — no additional dependencies needed.
 *
 * ## Known limitations (deliberately out of scope for v1)
 * - **Encoding:** Only UTF-8 is fully supported. Windows-1251 encoded FB2 files
 *   (common with older Russian e-books) may render incorrectly.
 * - **.fb2.zip:** Compressed FB2 files are NOT supported — a warning is emitted
 *   with instructions to extract first.
 * - **Multiple <body> elements:** Only the first <body> is processed. Some FB2
 *   files contain a second <body> for notes/footnotes.
 */
export class Fb2Extractor {
  // Tags skipped during section-text extraction (non-prose content)
  private static readonly SKIP_TAGS = new Set(['epigraph', 'annotation', 'image', 'binary']);

  /**
   * Collapse whitespace and trim.
   * Note: \r\n is already covered by \s+, but normalizing first keeps intent explicit.
   */
  static cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Extract text blocks from an FB2 file.
   *
   * Each top-level `<section>` inside `<body>` becomes one block.
   * Nested `<section>` elements are flattened into their parent block.
   *
   * @param fb2Path  Absolute path to the .fb2 file
   * @param minChars Minimum characters per block (default: 300)
   * @returns Array of cleaned text blocks
   */
  static async extract(fb2Path: string, minChars: number = 300): Promise<string[]> {
    // 1. Read file
    let xml: string;
    try {
      xml = await fs.readFile(fb2Path, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[WARN] Cannot read FB2 file "${fb2Path}": ${message}`);
      return [];
    }

    // 2. Detect compressed .fb2.zip (magic bytes: PK = 0x50 0x4B)
    if (xml.startsWith('PK')) {
      console.warn(
        `[WARN] "${fb2Path}" appears to be a compressed .fb2.zip file. ` +
        'Please extract it first. Only plain .fb2 files are supported.',
      );
      return [];
    }

    // 3. Parse XML with cheerio in xmlMode.
    //    FB2 uses xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"
    //    cheerio in xmlMode handles the default namespace transparently,
    //    so selectors like $('body'), $('section'), $('p') work directly.
    //
    //    NOTE: cheerio (htmlparser2) is fault-tolerant — it does NOT throw on
    //    malformed XML. Structural issues are caught downstream by the <body>
    //    presence check. The try/catch is a defensive guard for unexpected errors.
    let $: cheerio.CheerioAPI;
    try {
      $ = cheerio.load(xml, { xmlMode: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[WARN] Failed to parse FB2 XML in "${fb2Path}": ${message}`);
      return [];
    }

    // 4. Find the first <body> element
    const body = $('body').first();
    if (!body.length) {
      console.warn(`[WARN] No <body> element found in "${fb2Path}". Is this a valid FB2 file?`);
      return [];
    }

    // 5. Extract top-level <section> elements
    const blocks: string[] = [];
    body.children('section').each((_i, sectionEl) => {
      const text = Fb2Extractor.extractSectionText($, $(sectionEl));
      const cleaned = Fb2Extractor.cleanText(text);
      if (cleaned.length >= minChars) {
        blocks.push(cleaned);
      }
    });

    return blocks;
  }

  /**
   * Recursively extract all text content from a <section> element,
   * including nested sections.
   *
   * Elements explicitly skipped:
   * - <epigraph>   — epigraph (introductory quote)
   * - <annotation> — book annotation / blurb
   * - <image>      — image reference
   * - <binary>     — embedded binary data
   *
   * All other elements (<p>, <emphasis>, <strong>, <poem>, <cite>,
   * <subtitle>, etc.) have their text content extracted.
   */
  private static extractSectionText(
    $: cheerio.CheerioAPI,
    section: ReturnType<cheerio.CheerioAPI>,
  ): string {
    const parts: string[] = [];

    section.children().each((_i, child) => {
      const $child = $(child);
      // In cheerio xmlMode, `child.name` holds the lowercase tag name.
      // The `name` property is defined on Element nodes from domhandler.
      const tagName = (child as { name?: string }).name?.toLowerCase() ?? '';

      if (tagName === 'title') {
        const titleText = $child.text().trim();
        if (titleText) parts.push(titleText);
      } else if (tagName === 'section') {
        // Recurse: nested section becomes part of the parent block
        const nested = Fb2Extractor.extractSectionText($, $child);
        if (nested) parts.push(nested);
      } else if (Fb2Extractor.SKIP_TAGS.has(tagName)) {
        // Non-content elements: silently skip
      } else {
        // Content elements: <p>, <emphasis>, <strong>, <poem>, <cite>, <subtitle>, etc.
        const text = $child.text().trim();
        if (text) parts.push(text);
      }
    });

    return parts.join(' ');
  }
}
