import fs from 'node:fs/promises';
import path from 'node:path';
import EPub from 'epub';
import type { ExtractedImage } from './universal-extractor.js';
import {
  mimeToExtension,
  sanitizeImageFileName,
  scaleDownImage,
} from './image-utils.js';

/**
 * Extract embedded images from EPUB files into a target directory.
 *
 * Uses the `epub` library's `manifest` (image listing) and `getImage()`
 * (buffer retrieval).  Optionally downscales with `sharp` when installed.
 */
export class EpubImageExtractor {
  /**
   * Extract all images from an EPUB file.
   *
   * @param epubPath   Path to the .epub file
   * @param targetDir  Absolute path for copied image files
   * @param maxWidth   Scale images wider than this (default: 1200, 0 = no scale)
   * @returns Array of extracted image metadata
   */
  static async extract(
    epubPath: string,
    targetDir: string,
    maxWidth: number = 1200,
  ): Promise<ExtractedImage[]> {
    const epub = new EPub(epubPath);

    return new Promise<ExtractedImage[]>((resolve, reject) => {
      epub.on('end', async () => {
        try {
          // 1. Filter manifest for image/* entries (skip SVG)
          const imageEntries = Object.values(
            epub.manifest as Record<string, { id: string; href: string; 'media-type'?: string }>,
          ).filter(entry => {
            const mime = entry['media-type'] ?? '';
            return mime.startsWith('image/') && mime !== 'image/svg+xml';
          });

          if (imageEntries.length === 0) {
            resolve([]);
            return;
          }

          // 2. Ensure target directory exists
          await fs.mkdir(targetDir, { recursive: true });

          const existingNames = new Set<string>();
          const results: ExtractedImage[] = [];

          for (const entry of imageEntries) {
            try {
              const buffer: Buffer = await new Promise((res, rej) => {
                epub.getImage(
                  entry.id,
                  (err: Error | null, data: Buffer) => {
                    if (err) rej(err);
                    else res(data);
                  },
                );
              });

              if (!buffer || buffer.length === 0) continue;

              // 3. Optional downscale
              let finalBuffer = buffer;
              if (maxWidth > 0) {
                finalBuffer = await scaleDownImage(buffer, maxWidth);
              }

              // 4. Build sanitized file name
              const ext = mimeToExtension(
                entry['media-type'] ?? 'image/png',
              );
              const rawName = path
                .basename(entry.href ?? entry.id ?? 'image')
                .replace(new RegExp(`\\${ext.replace('.', '\\.')}$`, 'i'), '');

              const fileName =
                sanitizeImageFileName(rawName, existingNames) + ext;
              existingNames.add(fileName);

              // 5. Write to disk
              const destPath = path.join(targetDir, fileName);
              await fs.writeFile(destPath, finalBuffer);

              results.push({
                originalId: entry.id,
                fileName,
                vaultPath: destPath,
                mimeType: entry['media-type'] ?? 'image/png',
                sizeBytes: finalBuffer.length,
              });
            } catch {
              // Skip individual images that fail
            }
          }

          resolve(results);
        } catch (err) {
          reject(err);
        }
      });

      epub.on('error', (err: Error) => {
        reject(
          new Error(`Failed to parse EPUB images: ${err.message}`),
        );
      });

      epub.parse();
    });
  }
}
