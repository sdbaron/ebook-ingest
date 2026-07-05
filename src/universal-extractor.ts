import path from 'node:path';
import { EpubExtractor } from './epub-extractor.js';
import { PdfExtractor } from './pdf-extractor.js';
import { HtmlExtractor } from './html-extractor.js';

/**
 * Supported source formats.
 */
export type SourceFormat = 'epub' | 'pdf' | 'html' | 'url';

/**
 * Unified result from any extractor.
 */
export interface ExtractionResult {
  /** Extracted text blocks */
  blocks: string[];
  /** Detected source format */
  format: SourceFormat;
  /** Original source path or URL */
  sourcePath: string;
}

/**
 * Format-agnostic extraction layer.
 *
 * Detects the source format and delegates to the appropriate
 * extractor (EpubExtractor, PdfExtractor, HtmlExtractor).
 */
export class UniversalExtractor {
  /**
   * Extract text blocks from any supported source format.
   *
   * @param sourcePath File path or URL
   * @param minChars   Minimum characters per block (forwarded to extractors)
   */
  static async extract(
    sourcePath: string,
    minChars?: number,
  ): Promise<ExtractionResult> {
    const format = UniversalExtractor.detectFormat(sourcePath);
    let blocks: string[];

    switch (format) {
      case 'epub':
        blocks = await EpubExtractor.extract(sourcePath, minChars);
        break;
      case 'pdf':
        blocks = await PdfExtractor.extract(sourcePath, minChars);
        break;
      case 'html':
      case 'url':
        blocks = await HtmlExtractor.extract(sourcePath, minChars);
        break;
    }

    return { blocks, format, sourcePath };
  }

  /**
   * Detect the source format without extracting.
   *
   * @throws Error if the format cannot be determined
   */
  static detectFormat(sourcePath: string): SourceFormat {
    const lower = sourcePath.toLowerCase();
    const ext = path.extname(lower);

    if (ext === '.epub') return 'epub';
    if (ext === '.pdf') return 'pdf';
    if (ext === '.html' || ext === '.htm') return 'html';
    if (lower.startsWith('http://') || lower.startsWith('https://')) return 'url';

    throw new Error(
      `Unknown format for "${sourcePath}". ` +
      `Supported formats: .epub, .pdf, .html, .htm, http://, https://`,
    );
  }
}
