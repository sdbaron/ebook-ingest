import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrateVault } from '../src/migrate-vault.js';

describe('migrateVault', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ebook-ingest-migrate-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates source_registry from books_registry', async () => {
    // Setup v2 structure
    const metaDir = path.resolve(tmpDir, '99_meta');
    await fs.mkdir(metaDir, { recursive: true });

    const bookReg = {
      'Clean_Code': { project: 'Software' },
      'DDD': { project: 'Architecture' },
    };
    await fs.writeFile(
      path.resolve(metaDir, 'books_registry.json'),
      JSON.stringify(bookReg, null, 2),
      'utf-8',
    );

    await migrateVault(tmpDir);

    const sourceRegRaw = await fs.readFile(
      path.resolve(metaDir, 'sources_registry.json'),
      'utf-8',
    );
    const sourceReg = JSON.parse(sourceRegRaw);

    expect(sourceReg['Clean_Code']).toBeDefined();
    expect(sourceReg['Clean_Code'].source_type).toBe('epub');
    expect(sourceReg['Clean_Code'].project).toBe('Software');
    expect(sourceReg['DDD'].source_type).toBe('epub');
  });

  it('updates concept_registry books→sources', async () => {
    const metaDir = path.resolve(tmpDir, '99_meta');
    await fs.mkdir(metaDir, { recursive: true });

    const conceptReg = {
      'SRP': { books: ['Clean_Code'] },
      'DIP': { books: ['Clean_Code', 'DDD'] },
    };
    await fs.writeFile(
      path.resolve(metaDir, 'concept_registry.json'),
      JSON.stringify(conceptReg, null, 2),
      'utf-8',
    );

    await migrateVault(tmpDir);

    const updatedRaw = await fs.readFile(
      path.resolve(metaDir, 'concept_registry.json'),
      'utf-8',
    );
    const updated = JSON.parse(updatedRaw);

    expect(updated['SRP'].sources).toEqual(['Clean_Code']);
    expect(updated['SRP'].books).toEqual(['Clean_Code']); // backward compat
    expect(updated['DIP'].sources).toEqual(['Clean_Code', 'DDD']);
  });

  it('dry run does not modify files', async () => {
    const metaDir = path.resolve(tmpDir, '99_meta');
    await fs.mkdir(metaDir, { recursive: true });

    await fs.writeFile(
      path.resolve(metaDir, 'books_registry.json'),
      JSON.stringify({ 'Test': { project: 'X' } }, null, 2),
      'utf-8',
    );

    const log = await migrateVault(tmpDir, { dryRun: true });

    // Check that source_registry was NOT created
    let sourceRegExists = false;
    try {
      await fs.access(path.resolve(metaDir, 'sources_registry.json'));
      sourceRegExists = true;
    } catch { /* expected */ }
    expect(sourceRegExists).toBe(false);

    // Check that log contains dry-run messages
    const logText = log.join('\n');
    expect(logText).toContain('[DRY-RUN]');
  });

  it('handles empty vault gracefully', async () => {
    const log = await migrateVault(tmpDir);
    expect(log.length).toBeGreaterThan(0);
  });
});
