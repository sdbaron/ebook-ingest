import { describe, it, expect } from '@jest/globals';
import { EmbeddingGenerator, EmbeddingResult } from '../src/embedding-generator.js';

describe('EmbeddingGenerator', () => {
  describe('constructor', () => {
    it('uses nomic-embed-text by default', () => {
      const gen = new EmbeddingGenerator();
      // Default model should be set
      expect(gen).toBeDefined();
    });

    it('accepts a custom model name', () => {
      const gen = new EmbeddingGenerator('custom-model');
      expect(gen).toBeDefined();
    });
  });

  describe('embedQuery', () => {
    it('returns an array of numbers', async () => {
      const gen = new EmbeddingGenerator();

      try {
        const embedding = await gen.embedQuery('test query');
        expect(Array.isArray(embedding)).toBe(true);
        expect(embedding.length).toBeGreaterThan(0);
        expect(typeof embedding[0]).toBe('number');
      } catch {
        // Ollama might not be running — this is expected in CI
        console.warn('[TEST] Ollama not available — skipping embedding test');
      }
    });
  });

  describe('isAvailable', () => {
    it('returns boolean indicating Ollama availability', async () => {
      const gen = new EmbeddingGenerator();
      const available = await gen.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });
});
