import { describe, it, expect } from '@jest/globals';
import { EpubExtractor } from '../src/epub-extractor.js';

describe('EpubExtractor', () => {
  describe('cleanText', () => {
    it('collapses multiple whitespace into single space', () => {
      expect(EpubExtractor.cleanText('hello    world')).toBe('hello world');
    });

    it('trims leading and trailing whitespace', () => {
      expect(EpubExtractor.cleanText('  hello world  ')).toBe('hello world');
    });

    it('collapses newlines and tabs', () => {
      expect(EpubExtractor.cleanText('hello\n\tworld')).toBe('hello world');
    });

    it('handles empty string', () => {
      expect(EpubExtractor.cleanText('')).toBe('');
    });

    it('handles only whitespace', () => {
      expect(EpubExtractor.cleanText('   \n\t  ')).toBe('');
    });
  });
});
