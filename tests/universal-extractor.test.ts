import { describe, it, expect } from '@jest/globals';
import { UniversalExtractor, SourceFormat } from '../src/universal-extractor.js';

describe('UniversalExtractor', () => {
  describe('detectFormat', () => {
    it('detects .epub files', () => {
      expect(UniversalExtractor.detectFormat('book.epub')).toBe('epub');
      expect(UniversalExtractor.detectFormat('/path/to/book.EPUB')).toBe('epub');
    });

    it('detects .pdf files', () => {
      expect(UniversalExtractor.detectFormat('document.pdf')).toBe('pdf');
      expect(UniversalExtractor.detectFormat('/path/to/doc.PDF')).toBe('pdf');
    });

    it('detects .html files', () => {
      expect(UniversalExtractor.detectFormat('page.html')).toBe('html');
      expect(UniversalExtractor.detectFormat('/path/to/page.HTM')).toBe('html');
    });

    it('detects .htm files as html', () => {
      expect(UniversalExtractor.detectFormat('page.htm')).toBe('html');
    });

    it('detects http URLs as url', () => {
      expect(UniversalExtractor.detectFormat('http://example.com')).toBe('url');
    });

    it('detects https URLs as url', () => {
      expect(UniversalExtractor.detectFormat('https://example.com/page')).toBe('url');
      expect(UniversalExtractor.detectFormat('HTTPS://EXAMPLE.COM')).toBe('url');
    });

    it('throws on unknown format', () => {
      expect(() => UniversalExtractor.detectFormat('file.txt')).toThrow('Unknown format');
      expect(() => UniversalExtractor.detectFormat('file.docx')).toThrow('Unknown format');
      expect(() => UniversalExtractor.detectFormat('noextension')).toThrow('Unknown format');
    });
  });

  describe('extract', () => {
    it('extracts from HTML fixture', async () => {
      const result = await UniversalExtractor.extract(
        new URL('./fixtures/sample.html', import.meta.url).pathname,
      );
      expect(result.format).toBe('html');
      expect(result.blocks.length).toBeGreaterThan(0);
      expect(result.sourcePath).toContain('sample.html');
    });

    it('returns correct format in ExtractionResult', async () => {
      const result = await UniversalExtractor.extract(
        new URL('./fixtures/sample.html', import.meta.url).pathname,
      );
      expect(result.format).toBe('html');
      expect(Array.isArray(result.blocks)).toBe(true);
    });
  });
});
