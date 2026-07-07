import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Fb2Extractor } from '../src/fb2-extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, 'fixtures');
const sampleFb2 = path.resolve(fixturesDir, 'sample.fb2');

describe('Fb2Extractor', () => {
  describe('cleanText', () => {
    it('collapses multiple whitespace into single space', () => {
      expect(Fb2Extractor.cleanText('hello    world')).toBe('hello world');
    });

    it('trims leading and trailing whitespace', () => {
      expect(Fb2Extractor.cleanText('  hello world  ')).toBe('hello world');
    });

    it('collapses tabs and newlines', () => {
      expect(Fb2Extractor.cleanText('hello\n\tworld')).toBe('hello world');
    });

    it('normalizes Windows line endings', () => {
      expect(Fb2Extractor.cleanText('hello\r\nworld')).toBe('hello world');
    });

    it('handles empty string', () => {
      expect(Fb2Extractor.cleanText('')).toBe('');
    });
  });

  describe('extract', () => {
    // -- Happy Path -------------------------------------------------------
    let blocks: string[];

    beforeAll(async () => {
      blocks = await Fb2Extractor.extract(sampleFb2);
    });

    it('does not emit warnings for a valid FB2 file', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await Fb2Extractor.extract(sampleFb2);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('extracts one block per top-level section', () => {
      expect(blocks.length).toBe(3);
    });

    it('includes chapter title in the block text', () => {
      expect(blocks[0]).toContain('Chapter 1: Introduction');
    });

    it('includes paragraph content', () => {
      expect(blocks[0]).toContain('first paragraph of Chapter 1');
    });

    it('excludes epigraph content', () => {
      const allText = blocks.join(' ');
      expect(allText).not.toContain('should not appear');
    });

    it('strips XML tags but keeps inline-formatted text', () => {
      const allText = blocks.join(' ');
      // emphasis content preserved without tags
      expect(allText).toContain('FB2 extractor');
      // strong content preserved without tags
      expect(allText).toContain('extractor');
    });

    it('excludes image references', () => {
      const allText = blocks.join(' ');
      expect(allText).not.toContain('<image');
      expect(allText).not.toContain('l:href');
    });

    it('flattens nested sections into parent block', () => {
      // Still 3 blocks — nested section is NOT a separate block
      expect(blocks.length).toBe(3);
      expect(blocks[1]).toContain('Nested Sub-Section');
    });

    // -- minChars Filter ---------------------------------------------------

    it('filters out all blocks when minChars is very high', async () => {
      const blocks = await Fb2Extractor.extract(sampleFb2, 99999);
      expect(blocks).toEqual([]);
    });

    // -- Error Handling ----------------------------------------------------

    it('returns empty array for non-existent file', async () => {
      const result = await Fb2Extractor.extract('/nonexistent/test.fb2');
      expect(result).toEqual([]);
    });

    it('returns empty array for empty file', async () => {
      const tmpFile = path.resolve(os.tmpdir(), `test-empty-${Date.now()}.fb2`);
      await fs.writeFile(tmpFile, '', 'utf-8');
      try {
        const result = await Fb2Extractor.extract(tmpFile);
        expect(result).toEqual([]);
      } finally {
        await fs.unlink(tmpFile).catch(() => {});
      }
    });

    it('returns empty array for malformed XML', async () => {
      const tmpFile = path.resolve(os.tmpdir(), `test-malformed-${Date.now()}.fb2`);
      await fs.writeFile(tmpFile, '<FictionBook><unclosed', 'utf-8');
      try {
        const result = await Fb2Extractor.extract(tmpFile);
        expect(result).toEqual([]);
      } finally {
        await fs.unlink(tmpFile).catch(() => {});
      }
    });

    it('returns empty array for .fb2.zip input (PK header)', async () => {
      const tmpFile = path.resolve(os.tmpdir(), `test-zip-${Date.now()}.fb2`);
      // "PK" is the magic header for ZIP files
      await fs.writeFile(tmpFile, 'PK\u0003\u0004rest of zip file content', 'utf-8');
      try {
        const result = await Fb2Extractor.extract(tmpFile);
        expect(result).toEqual([]);
      } finally {
        await fs.unlink(tmpFile).catch(() => {});
      }
    });
  });
});
