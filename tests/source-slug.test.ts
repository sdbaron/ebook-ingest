import { describe, it, expect } from '@jest/globals';
import { SourceSlug } from '../src/source-slug.js';

describe('SourceSlug', () => {
  describe('toKebabCase', () => {
    it('converts spaces to hyphens and lowercases', () => {
      expect(SourceSlug.toKebabCase('Clean Architecture')).toBe(
        'clean-architecture',
      );
    });

    it('removes special characters', () => {
      expect(SourceSlug.toKebabCase('Release It! 2nd Ed.')).toBe(
        'release-it-2nd-ed',
      );
    });

    it('collapses multiple hyphens', () => {
      expect(SourceSlug.toKebabCase('Foo---Bar')).toBe('foo-bar');
    });

    it('trims leading/trailing hyphens', () => {
      expect(SourceSlug.toKebabCase('-Foo-')).toBe('foo');
    });

    it('handles already kebab-case input', () => {
      expect(SourceSlug.toKebabCase('already-kebab')).toBe('already-kebab');
    });

    it('returns fallback for symbol-only input', () => {
      expect(SourceSlug.toKebabCase('!!!')).toBe('source');
    });
  });
});
