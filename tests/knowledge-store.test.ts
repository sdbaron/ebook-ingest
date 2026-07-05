import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeStore, SourceEntry } from '../src/knowledge-store.js';
import { RegistryManager } from '../src/registry-manager.js';

describe('KnowledgeStore', () => {
  let tmpDir: string;
  let conceptRegPath: string;
  let sourceRegPath: string;
  let store: KnowledgeStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ebook-ingest-test-'));
    conceptRegPath = path.join(tmpDir, 'concept_registry.json');
    sourceRegPath = path.join(tmpDir, 'sources_registry.json');
    await RegistryManager.ensure(tmpDir, conceptRegPath, sourceRegPath);
    store = new KnowledgeStore(conceptRegPath, sourceRegPath);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('registerSource', () => {
    it('registers a source with correct metadata', async () => {
      await store.registerSource('My Book', 'Testing', 'epub', '/path/to/book.epub');

      const sources = await RegistryManager.load<Record<string, SourceEntry>>(sourceRegPath);
      expect(sources['My Book']).toBeDefined();
      expect(sources['My Book'].project).toBe('Testing');
      expect(sources['My Book'].source_type).toBe('epub');
      expect(sources['My Book'].original_path).toBe('/path/to/book.epub');
      expect(sources['My Book'].ingested_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('supports pdf source_type', async () => {
      await store.registerSource('Paper', 'Research', 'pdf', '/papers/doc.pdf');
      const sources = await RegistryManager.load<Record<string, SourceEntry>>(sourceRegPath);
      expect(sources['Paper'].source_type).toBe('pdf');
    });

    it('supports url source_type', async () => {
      await store.registerSource('Article', 'Web', 'url', 'https://example.com');
      const sources = await RegistryManager.load<Record<string, SourceEntry>>(sourceRegPath);
      expect(sources['Article'].source_type).toBe('url');
    });
  });

  describe('registerBook (deprecated)', () => {
    it('delegates to registerSource with epub type', async () => {
      await store.registerBook('Legacy Book', 'OldProject');

      const sources = await RegistryManager.load<Record<string, SourceEntry>>(sourceRegPath);
      expect(sources['Legacy Book']).toBeDefined();
      expect(sources['Legacy Book'].source_type).toBe('epub');
      expect(sources['Legacy Book'].project).toBe('OldProject');
    });
  });

  describe('registerConcept', () => {
    it('registers a concept with source association', async () => {
      await store.registerConcept('Dependency_Inversion', 'Clean Code');

      const concepts = await RegistryManager.load<Record<string, { sources: string[]; books: string[] }>>(conceptRegPath);
      expect(concepts['Dependency_Inversion']).toBeDefined();
      expect(concepts['Dependency_Inversion'].sources).toContain('Clean Code');
      expect(concepts['Dependency_Inversion'].books).toContain('Clean Code');
    });

    it('appends source to existing concept', async () => {
      await store.registerConcept('SRP', 'Clean Code');
      await store.registerConcept('SRP', 'Clean Architecture');

      const concepts = await RegistryManager.load<Record<string, { sources: string[] }>>(conceptRegPath);
      expect(concepts['SRP'].sources).toEqual(['Clean Code', 'Clean Architecture']);
    });

    it('does not duplicate sources', async () => {
      await store.registerConcept('SRP', 'Clean Code');
      await store.registerConcept('SRP', 'Clean Code');

      const concepts = await RegistryManager.load<Record<string, { sources: string[] }>>(conceptRegPath);
      expect(concepts['SRP'].sources).toEqual(['Clean Code']);
    });
  });
});
