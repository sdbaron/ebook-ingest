/**
 * Shared helpers for EPUB and FB2 image extractors.
 *
 * Internal module — not exported from the public API.
 */

/** Map MIME type to file extension (including leading dot). */
export function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
  };
  return map[mimeType] ?? '.png';
}

/**
 * Sanitize a raw file name for the vault file system.
 * - Lowercase
 * - Non-alphanumeric → hyphen
 * - Collision-safe: appends `-1`, `-2`, … when needed
 */
export function sanitizeImageFileName(
  original: string,
  existingNames: Set<string>,
): string {
  let base =
    original
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'image';

  let candidate = base;
  let counter = 1;
  while (existingNames.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter++;
  }
  return candidate;
}

// Cache the sharp import so every image doesn't trigger a dynamic require.
let sharpModule: typeof import('sharp').default | null | undefined;

/**
 * Try to downscale an image buffer with `sharp`.
 * Returns the original buffer when `sharp` is unavailable or fails.
 */
export async function scaleDownImage(
  buffer: Buffer,
  maxWidth: number,
): Promise<Buffer> {
  if (sharpModule === undefined) {
    try {
      const mod = await import('sharp');
      sharpModule = mod.default;
    } catch {
      sharpModule = null; // sharp not installed
    }
  }

  if (!sharpModule) return buffer;

  try {
    const metadata = await sharpModule(buffer).metadata();
    if (metadata.width && metadata.width > maxWidth) {
      return sharpModule(buffer)
        .resize({ width: maxWidth, withoutEnlargement: true })
        .toBuffer();
    }
  } catch {
    // sharp can fail on non-image buffers (e.g. GIFs)
  }

  return buffer;
}
