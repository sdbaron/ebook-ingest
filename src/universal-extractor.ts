import path from 'node:path';
import { EpubExtractor } from './epub-extractor.js';
import { Fb2Extractor } from './fb2-extractor.js';
import { PdfExtractor } from './pdf-extractor.js';
import { HtmlExtractor } from './html-extractor.js';
import { EpubImageExtractor } from './epub-image-extractor.js';
import { Fb2ImageExtractor } from './fb2-image-extractor.js';
import { TextPreprocessor } from './text-preprocessor.js';

/**
 * Metadata about a single extracted image.
 */
export interface ExtractedImage {
  /** Original-ID from the source manifest (e.g. "cover.jpg") */
  originalId: string;
  /** Sanitized file name in the target directory */
  fileName: string;
  /** Absolute path to the copied image file */
  vaultPath: string;
  /** MIME type (e.g. "image/png") */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
}

/**
 * Supported source formats.
 */
export type SourceFormat = 'epub' | 'pdf' | 'html' | 'url' | 'fb2';

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
  private preprocessor?: TextPreprocessor;

  constructor(preprocessor?: TextPreprocessor) {
    this.preprocessor = preprocessor;
  }

  /**
   * Extract text blocks from any supported source format.
   *
   * @param sourcePath File path or URL
   * @param minChars   Minimum characters per block (forwarded to extractors)
   */
  async extract(
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
      case 'fb2':
        blocks = await Fb2Extractor.extract(sourcePath, minChars);
        break;
    }

    // Apply preprocessing if configured.
    // FB2 is clean structured XML — use 'epub' preprocessing mode as fallback.
    if (this.preprocessor) {
      const preprocessFormat = format === 'fb2' ? 'epub' : format;
      const result = this.preprocessor.process(blocks, preprocessFormat);
      console.log(
        `[PREPROCESS] ${result.stats.originalBlockCount} → ${result.stats.filteredBlockCount} blocks ` +
        `(format: ${format})`,
      );
      blocks = result.blocks;
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
    if (ext === '.fb2') return 'fb2';
    if (ext === '.html' || ext === '.htm') return 'html';
    if (lower.startsWith('http://') || lower.startsWith('https://')) return 'url';

    throw new Error(
      `Unknown format for "${sourcePath}". ` +
      `Supported formats: .epub, .pdf, .html, .htm, .fb2, http://, https://`,
    );
  }

  /**
   * Extract images from a source and copy them to the target directory.
   *
   * Supported formats: EPUB (manifest images via getImage), FB2 (base64 <binary>).
   * PDF and HTML/URL image extraction is planned for a future release.
   *
   * @param sourcePath  File path or URL
   * @param targetDir   Absolute path where image files will be written
   * @param maxWidth    Optional max width for downscaling (default: 1200)
   * @returns Array of extracted image metadata
   */
  async extractImages(
    sourcePath: string,
    targetDir: string,
    maxWidth?: number,
  ): Promise<ExtractedImage[]> {
    const format = UniversalExtractor.detectFormat(sourcePath);

    switch (format) {
      case 'epub':
        return EpubImageExtractor.extract(sourcePath, targetDir, maxWidth);
      case 'fb2':
        return Fb2ImageExtractor.extract(sourcePath, targetDir, maxWidth);
      case 'pdf':
        console.warn('[WARN] PDF image extraction is not supported yet.');
        return [];
      case 'html':
      case 'url':
        console.warn(
          '[WARN] HTML/URL image extraction is planned for a future release.',
        );
        return [];
    }
  }
}
