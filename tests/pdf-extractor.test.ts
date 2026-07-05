import { describe, it, expect } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfExtractor } from '../src/pdf-extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('PdfExtractor', () => {
  describe('cleanText', () => {
    it('collapses multiple whitespace into single space', () => {
      expect(PdfExtractor.cleanText('hello    world')).toBe('hello world');
    });

    it('trims leading and trailing whitespace', () => {
      expect(PdfExtractor.cleanText('  hello world  ')).toBe('hello world');
    });

    it('collapses newlines and tabs', () => {
      expect(PdfExtractor.cleanText('hello\n\tworld')).toBe('hello world');
    });

    it('handles empty string', () => {
      expect(PdfExtractor.cleanText('')).toBe('');
    });
  });

  describe('extract', () => {
    const samplePdf = path.resolve(fixturesDir, 'sample.pdf');

    it('extracts text from a valid PDF', async () => {
      const blocks = await PdfExtractor.extract(samplePdf, 10);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0]).toContain('Test PDF Content');
    });

    it('returns empty array for non-existent file', async () => {
      const blocks = await PdfExtractor.extract('/nonexistent/file.pdf');
      expect(blocks).toEqual([]);
    });

    it('filters pages below minChars', async () => {
      // With a high minChars threshold, our small test PDF should be filtered
      const blocks = await PdfExtractor.extract(samplePdf, 9999);
      expect(blocks).toEqual([]);
    });
  });
});
