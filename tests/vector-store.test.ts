import { describe, it, expect } from '@jest/globals';
import { VectorStore, buildDocId, VectorDocument } from '../src/vector-store.js';

describe('VectorStore', () => {
  describe('buildDocId', () => {
    it('builds deterministic IDs from source name and block index', () => {
      expect(buildDocId('Clean_Code', 1)).toBe('Clean_Code__block_001');
      expect(buildDocId('Clean_Code', 42)).toBe('Clean_Code__block_042');
      expect(buildDocId('My_PDF_Source', 100)).toBe('My_PDF_Source__block_100');
    });
  });

  describe('constructor', () => {
    it('creates a store with default URL', () => {
      const store = new VectorStore();
      expect(store.isConnected()).toBe(false);
    });

    it('creates a store with custom URL and collection', () => {
      const store = new VectorStore('http://localhost:9999', 'test_collection');
      expect(store.isConnected()).toBe(false);
    });
  });

  describe('disconnected behavior', () => {
    it('addDocuments does nothing when not connected', async () => {
      const store = new VectorStore();
      // Should not throw
      await store.addDocuments([]);
    });

    it('query returns empty array when not connected', async () => {
      const store = new VectorStore();
      const results = await store.query([0.1, 0.2, 0.3]);
      expect(results).toEqual([]);
    });

    it('count returns 0 when not connected', async () => {
      const store = new VectorStore();
      expect(await store.count()).toBe(0);
    });
  });
});
