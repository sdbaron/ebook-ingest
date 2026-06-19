import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RegistryManager } from '../src/registry-manager.js';

describe('RegistryManager', () => {
  let tmpDir: string;
  let conceptRegPath: string;
  let bookRegPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ebook-ingest-test-'));
    conceptRegPath = path.join(tmpDir, 'concept_registry.json');
    bookRegPath = path.join(tmpDir, 'books_registry.json');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('ensure', () => {
    it('creates registry files if they do not exist', async () => {
      await RegistryManager.ensure(tmpDir, conceptRegPath, bookRegPath);

      const conceptExists = await fs
        .access(conceptRegPath)
        .then(() => true)
        .catch(() => false);
      const bookExists = await fs
        .access(bookRegPath)
        .then(() => true)
        .catch(() => false);

      expect(conceptExists).toBe(true);
      expect(bookExists).toBe(true);
    });

    it('does not overwrite existing registry files', async () => {
      await fs.writeFile(conceptRegPath, JSON.stringify({ existing: true }), 'utf-8');
      await RegistryManager.ensure(tmpDir, conceptRegPath, bookRegPath);

      const data = await RegistryManager.load<{ existing: boolean }>(conceptRegPath);
      expect(data.existing).toBe(true);
    });
  });

  describe('load and save', () => {
    it('saves and loads JSON data', async () => {
      const data = { foo: 'bar', items: [1, 2, 3] };
      await RegistryManager.save(conceptRegPath, data);

      const loaded = await RegistryManager.load<typeof data>(conceptRegPath);
      expect(loaded).toEqual(data);
    });

    it('load returns empty object from default empty registry', async () => {
      await RegistryManager.ensure(tmpDir, conceptRegPath, bookRegPath);
      const data = await RegistryManager.load(conceptRegPath);
      expect(data).toEqual({});
    });
  });

  describe('registryPath', () => {
    it('resolves path relative to vault', () => {
      const result = RegistryManager.registryPath('/vault', '99_meta/concept_registry.json');
      expect(result).toBe(path.resolve('/vault', '99_meta/concept_registry.json'));
    });
  });
});
