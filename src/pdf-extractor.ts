import fs from 'node:fs';
import { PDFParse } from 'pdf-parse';

/**
 * Extract clean text blocks from PDF files.
 *
 * Uses pdf-parse to extract the text layer from text-based PDFs.
 * Scanned PDFs (no text layer) will produce a warning and return an empty array.
 */
export class PdfExtractor {
  /**
   * Collapse whitespace and trim.
   */
  static cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Extract text blocks from a PDF file.
   *
   * Text is split into page groups. Pages with fewer than `minChars`
   * characters are filtered out (e.g. empty pages, imprint).
   *
   * @param pdfPath  Absolute or relative path to the .pdf file
   * @param minChars Minimum characters per block (default: 300)
   * @returns Array of text blocks, one per significant page
   */
  static async extract(pdfPath: string, minChars: number = 300): Promise<string[]> {
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(pdfPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[WARN] Cannot read PDF file "${pdfPath}": ${message}`);
      return [];
    }

    let parser: PDFParse;
    try {
      parser = new PDFParse({ data: buffer });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[WARN] PDF parsing failed for "${pdfPath}": ${message}`);
      console.warn('[WARN] This may be a scanned PDF without a text layer.');
      return [];
    }

    try {
      const textResult = await parser.getText();

      // textResult has page-wise text in `pages` and concatenated in `text`
      const pages: string[] = textResult.pages?.map((p: { text: string }) => p.text) ?? [];

      if (pages.length === 0) {
        // Fall back to concatenated text
        const fullText = PdfExtractor.cleanText(textResult.text);
        if (fullText.length >= minChars) {
          return [fullText];
        }
        console.warn(
          `[WARN] PDF "${pdfPath}" produced no text blocks above ${minChars} characters. ` +
          `Total text length: ${fullText.length}. This PDF may be scanned or image-based.`,
        );
        return [];
      }

      const blocks: string[] = [];
      for (const page of pages) {
        const cleaned = PdfExtractor.cleanText(page);
        if (cleaned.length >= minChars) {
          blocks.push(cleaned);
        }
      }

      return blocks;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[WARN] PDF text extraction failed for "${pdfPath}": ${message}`);
      return [];
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
}
