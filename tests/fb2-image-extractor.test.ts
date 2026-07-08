import { describe, it, expect } from '@jest/globals';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Fb2ImageExtractor } from '../src/fb2-image-extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, 'fixtures');
const sampleFb2 = path.resolve(fixturesDir, 'sample-image.fb2');
const noImagesFb2 = path.resolve(fixturesDir, 'sample.fb2');

describe('Fb2ImageExtractor', () => {
  describe('extract', () => {
    it('extracts base64-encoded image from <binary> element', async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'fb2-img-test-'),
      );
      try {
        const results = await Fb2ImageExtractor.extract(
          sampleFb2,
          tmpDir,
        );
        expect(results.length).toBe(1);
        expect(results[0].fileName).toMatch(/\.png$/i);
        expect(results[0].mimeType).toBe('image/png');
        expect(results[0].sizeBytes).toBeGreaterThan(0);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('writes decoded image to target directory', async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'fb2-img-test-'),
      );
      try {
        const results = await Fb2ImageExtractor.extract(
          sampleFb2,
          tmpDir,
        );
        const destPath = path.join(tmpDir, results[0].fileName);
        const stat = await fs.stat(destPath);
        expect(stat.size).toBe(results[0].sizeBytes);

        // Verify it's a valid PNG
        const header = Buffer.alloc(8);
        const fh = await fs.open(destPath, 'r');
        await fh.read(header, 0, 8, 0);
        await fh.close();
        expect(header[0]).toBe(0x89); // PNG magic
        expect(header[1]).toBe(0x50);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns empty array for FB2 without <binary> elements', async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'fb2-img-test-'),
      );
      try {
        const results = await Fb2ImageExtractor.extract(
          noImagesFb2,
          tmpDir,
        );
        expect(results).toEqual([]);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns empty array for non-existent file', async () => {
      const results = await Fb2ImageExtractor.extract(
        '/nonexistent/test.fb2',
        os.tmpdir(),
      );
      expect(results).toEqual([]);
    });

    it('returns empty array for malformed XML', async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'fb2-img-test-'),
      );
      const tmpFile = path.join(tmpDir, 'test.fb2');
      await fs.writeFile(tmpFile, '<FictionBook><unclosed', 'utf-8');
      try {
        const results = await Fb2ImageExtractor.extract(
          tmpFile,
          tmpDir,
        );
        expect(results).toEqual([]);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('handles empty base64 data gracefully', async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'fb2-img-test-'),
      );
      const tmpFile = path.join(tmpDir, 'test.fb2');
      await fs.writeFile(
        tmpFile,
        `<?xml version="1.0"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><binary id="empty" content-type="image/png">   </binary></FictionBook>`,
        'utf-8',
      );
      try {
        const results = await Fb2ImageExtractor.extract(
          tmpFile,
          tmpDir,
        );
        // Empty or whitespace-only base64 → skipped
        expect(results).toEqual([]);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('sanitizes file names', async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'fb2-img-test-'),
      );
      const tmpFile = path.join(tmpDir, 'test.fb2');
      // Using a minimal 1x1 PNG with spaces in the binary id
      await fs.writeFile(
        tmpFile,
        `<?xml version="1.0"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><binary id="My Cover Image.jpg" content-type="image/jpeg">/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA=</binary></FictionBook>`,
        'utf-8',
      );
      try {
        const results = await Fb2ImageExtractor.extract(
          tmpFile,
          tmpDir,
        );
        expect(results.length).toBe(1);
        // Should become lowercase, spaces → hyphens
        expect(results[0].fileName).toMatch(
          /^my-cover-image(-\d+)?\.jpg$/,
        );
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
