import { describe, it, expect } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HtmlExtractor } from '../src/html-extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('HtmlExtractor', () => {
  describe('cleanText', () => {
    it('collapses multiple whitespace into single space', () => {
      expect(HtmlExtractor.cleanText('hello    world')).toBe('hello world');
    });

    it('trims leading and trailing whitespace', () => {
      expect(HtmlExtractor.cleanText('  hello world  ')).toBe('hello world');
    });

    it('handles empty string', () => {
      expect(HtmlExtractor.cleanText('')).toBe('');
    });
  });

  describe('extract', () => {
    const sampleHtml = path.resolve(fixturesDir, 'sample.html');

    it('extracts text from a local HTML file', async () => {
      const blocks = await HtmlExtractor.extract(sampleHtml, 50);
      expect(blocks.length).toBeGreaterThan(0);
      const allText = blocks.join(' ');
      expect(allText).toContain('Test HTML Document');
      expect(allText).toContain('first paragraph');
    });

    it('removes script and style content', async () => {
      const blocks = await HtmlExtractor.extract(sampleHtml, 50);
      const allText = blocks.join(' ');
      expect(allText).not.toContain("console.log");
      expect(allText).not.toContain('font-family');
    });

    it('removes navigation content', async () => {
      const blocks = await HtmlExtractor.extract(sampleHtml, 50);
      const allText = blocks.join(' ');
      expect(allText).not.toContain('Home');
    });

    it('removes sidebar content', async () => {
      const blocks = await HtmlExtractor.extract(sampleHtml, 50);
      const allText = blocks.join(' ');
      expect(allText).not.toContain('sidebar content should be removed');
    });

    it('splits into blocks of at least minChars', async () => {
      const blocks = await HtmlExtractor.extract(sampleHtml, 100);
      for (const block of blocks) {
        expect(block.length).toBeGreaterThanOrEqual(100);
      }
    });

    it('returns empty array for non-existent file', async () => {
      const blocks = await HtmlExtractor.extract('/nonexistent/file.html');
      expect(blocks).toEqual([]);
    });

    it('returns empty array for unreachable URL', async () => {
      const blocks = await HtmlExtractor.extract('http://localhost:99999/nonexistent.html');
      expect(blocks).toEqual([]);
    });
  });
});
