import { describe, it, expect } from '@jest/globals';
import { ConceptNormalizer } from '../src/concept-normalizer.js';

describe('ConceptNormalizer', () => {
  describe('normalize', () => {
    it('trims whitespace', () => {
      expect(ConceptNormalizer.normalize('  Hello World  ')).toBe('Hello_World');
    });

    it('replaces slashes with underscores', () => {
      expect(ConceptNormalizer.normalize('Input/Output')).toBe('Input_Output');
    });

    it('replaces spaces with underscores', () => {
      expect(ConceptNormalizer.normalize('Domain Driven Design')).toBe('Domain_Driven_Design');
    });

    it('removes special characters', () => {
      expect(ConceptNormalizer.normalize('C++: Advanced Topics!')).toBe('C_Advanced_Topics');
    });

    it('preserves digits and letters', () => {
      expect(ConceptNormalizer.normalize('TypeScript 5.0')).toBe('TypeScript_50');
    });

    it('handles empty string', () => {
      expect(ConceptNormalizer.normalize('')).toBe('');
    });

    it('handles multiple consecutive spaces', () => {
      expect(ConceptNormalizer.normalize('Hello    World')).toBe('Hello_World');
    });

    it('normalizes German umlauts by removing them', () => {
      // Normalizer only keeps [A-Za-z0-9_], umlauts are stripped
      expect(ConceptNormalizer.normalize('Überblick')).toBe('berblick');
    });
  });
});
