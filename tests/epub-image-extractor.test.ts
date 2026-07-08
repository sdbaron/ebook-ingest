import { describe, it, expect } from '@jest/globals';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { EpubImageExtractor } from '../src/epub-image-extractor.js';
import { ObsidianWriter } from '../src/obsidian-writer.js';

describe('EpubImageExtractor', () => {
  describe('extract', () => {
    it('returns empty array for non-existent file', async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'epub-img-test-'),
      );
      try {
        const promise = EpubImageExtractor.extract(
          '/nonexistent/test.epub',
          tmpDir,
        );
        await expect(promise).rejects.toThrow();
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('handles corrupted EPUB gracefully', async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'epub-img-test-'),
      );
      const tmpFile = path.join(tmpDir, 'corrupt.epub');
      await fs.writeFile(tmpFile, 'not a valid epub file', 'utf-8');
      try {
        const promise = EpubImageExtractor.extract(tmpFile, tmpDir);
        await expect(promise).rejects.toThrow();
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});

describe('ObsidianWriter.imageEmbed', () => {
  it('builds a correct Wikilink embed', () => {
    const embed = ObsidianWriter.imageEmbed(
      '06_attachments',
      'clean-architecture',
      'fig-3-1.png',
    );
    expect(embed).toBe(
      '![[06_attachments/clean-architecture/fig-3-1.png]]',
    );
  });

  it('handles source names with spaces', () => {
    const embed = ObsidianWriter.imageEmbed(
      '06_attachments',
      'Clean Architecture',
      'cover.jpg',
    );
    expect(embed).toBe(
      '![[06_attachments/Clean Architecture/cover.jpg]]',
    );
  });
});
