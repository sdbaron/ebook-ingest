import * as cheerio from 'cheerio';
import EPub from 'epub';

/**
 * Extract clean text chapters from an EPUB file.
 */
export class EpubExtractor {
  /**
   * Collapse whitespace and trim.
   */
  static cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Extract chapters from an EPUB file.
   * Returns an array of text strings, one per chapter.
   *
   * @param epubPath Path to the .epub file
   * @param minChars Minimum characters per chapter (default: 500)
   */
  static async extract(epubPath: string, minChars: number = 500): Promise<string[]> {
    const epub = new EPub(epubPath);

    return new Promise<string[]>((resolve, reject) => {
      epub.on('end', async () => {
        const chapters: string[] = [];

        for (const chapter of epub.flow) {
          try {
            const content = await new Promise<string>((res, rej) => {
              epub.getChapter(chapter.id, (err: Error, text: string) => {
                if (err) rej(err);
                else res(text);
              });
            });

            const $ = cheerio.load(content);
            const text = $.text();
            const cleaned = EpubExtractor.cleanText(text);

            if (cleaned.length > minChars) {
              chapters.push(cleaned);
            }
          } catch {
            // Skip chapters that fail to load
          }
        }

        resolve(chapters);
      });

      epub.on('error', (err: Error) => {
        reject(new Error(`Failed to parse EPUB: ${err.message}`));
      });

      epub.parse();
    });
  }
}
