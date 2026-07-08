import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import type { ExtractedImage } from './universal-extractor.js';
import {
  mimeToExtension,
  sanitizeImageFileName,
  scaleDownImage,
} from './image-utils.js';

/**
 * Extract base64-encoded images from FictionBook 2 (.fb2) files.
 *
 * FB2 stores images as `<binary id="…" content-type="…">base64…</binary>`.
 * This extractor decodes those elements and writes the resulting files
 * into the target directory.
 */
export class Fb2ImageExtractor {
  /**
   * Extract all images from an FB2 file.
   *
   * @param fb2Path   Path to the .fb2 file
   * @param targetDir Absolute path for copied image files
   * @param maxWidth  Scale images wider than this (default: 1200, 0 = no scale)
   * @returns Array of extracted image metadata
   */
  static async extract(
    fb2Path: string,
    targetDir: string,
    maxWidth: number = 1200,
  ): Promise<ExtractedImage[]> {
    // 1. Read file
    let xml: string;
    try {
      xml = await fs.readFile(fb2Path, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[WARN] Cannot read FB2 file for images "${fb2Path}": ${message}`,
      );
      return [];
    }

    // 2. Parse XML
    let $: cheerio.CheerioAPI;
    try {
      $ = cheerio.load(xml, { xmlMode: true });
    } catch {
      console.warn(
        `[WARN] Failed to parse FB2 XML for image extraction: "${fb2Path}"`,
      );
      return [];
    }

    // 3. Find <binary> elements
    const binaries = $('binary');
    if (binaries.length === 0) return [];

    // 4. Ensure target directory exists
    await fs.mkdir(targetDir, { recursive: true });

    const existingNames = new Set<string>();
    const results: ExtractedImage[] = [];

    for (let i = 0; i < binaries.length; i++) {
      const el = binaries[i];
      const $el = $(el);

      const id = $el.attr('id') ?? `image-${i}`;
      const mimeType = $el.attr('content-type') ?? 'image/jpeg';
      const base64Data = $el.text().replace(/\s/g, '');

      if (!base64Data) continue;

      try {
        let rawBuffer: Buffer = Buffer.from(base64Data, 'base64');
        if (rawBuffer.length === 0) continue;

        // 5. Optional downscale
        if (maxWidth > 0) {
          rawBuffer = await scaleDownImage(rawBuffer, maxWidth);
        }

        // 6. Build sanitized file name
        const ext = mimeToExtension(mimeType);
        const rawName = path
          .basename(id, ext)
          .replace(new RegExp(`\\${ext.replace('.', '\\.')}$`, 'i'), '');

        const fileName =
          sanitizeImageFileName(rawName, existingNames) + ext;
        existingNames.add(fileName);

        // 7. Write to disk
        const destPath = path.join(targetDir, fileName);
        await fs.writeFile(destPath, rawBuffer);

        results.push({
          originalId: id,
          fileName,
          vaultPath: destPath,
          mimeType,
          sizeBytes: rawBuffer.length,
        });
      } catch {
        // Skip individual entries that fail
      }
    }

    return results;
  }
}
