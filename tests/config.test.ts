import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import {
  defaultConfig,
  loadConfig,
  findConfigFile,
  CONFIG_SEARCH_NAMES,
} from '../src/config.js';

describe('config', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ebook-ingest-config-test-'),
    );
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('findConfigFile', () => {
    it('returns null when no config file exists', () => {
      const emptyDir = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });
      expect(findConfigFile(emptyDir)).toBeNull();
    });

    it('finds .ebook-ingestrc', () => {
      const dir = path.join(tmpDir, 'rc');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.ebook-ingestrc'), '{}', 'utf-8');
      expect(findConfigFile(dir)).toContain('.ebook-ingestrc');
    });

    it('finds .ebook-ingestrc.json', () => {
      const dir = path.join(tmpDir, 'rcjson');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.ebook-ingestrc.json'),
        '{}',
        'utf-8',
      );
      expect(findConfigFile(dir)).toContain('.ebook-ingestrc.json');
    });

    it('finds .ebook-ingest.json', () => {
      const dir = path.join(tmpDir, 'dotjson');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.ebook-ingest.json'),
        '{}',
        'utf-8',
      );
      expect(findConfigFile(dir)).toContain('.ebook-ingest.json');
    });

    it('finds ebook-ingest.config.json', () => {
      const dir = path.join(tmpDir, 'configjson');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'ebook-ingest.config.json'),
        '{}',
        'utf-8',
      );
      expect(findConfigFile(dir)).toContain('ebook-ingest.config.json');
    });

    it('returns first match in priority order', () => {
      const dir = path.join(tmpDir, 'priority');
      fs.mkdirSync(dir, { recursive: true });
      // Create two files; first priority should win
      fs.writeFileSync(
        path.join(dir, CONFIG_SEARCH_NAMES[0]),
        JSON.stringify({ model: 'first-priority' }),
        'utf-8',
      );
      fs.writeFileSync(
        path.join(dir, CONFIG_SEARCH_NAMES[1]),
        JSON.stringify({ model: 'second-priority' }),
        'utf-8',
      );
      const found = findConfigFile(dir);
      expect(found).toContain(CONFIG_SEARCH_NAMES[0]);
    });
  });

  describe('loadConfig', () => {
    it('returns defaults when no config file exists', () => {
      const emptyDir = path.join(tmpDir, 'no-config');
      fs.mkdirSync(emptyDir, { recursive: true });
      const config = loadConfig(emptyDir);
      expect(config.vault).toBe(defaultConfig.vault);
      expect(config.model).toBe(defaultConfig.model);
      expect(config.sourcesDir).toBe(defaultConfig.sourcesDir);
    });

    it('merges auto-discovered config over defaults', () => {
      const dir = path.join(tmpDir, 'auto');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.ebook-ingest.json'),
        JSON.stringify({ model: 'custom-model', vault: '/custom/vault' }),
        'utf-8',
      );
      const config = loadConfig(dir);
      expect(config.model).toBe('custom-model');
      expect(config.vault).toBe('/custom/vault');
      // Non-overridden values keep defaults
      expect(config.sourcesDir).toBe(defaultConfig.sourcesDir);
    });

    it('explicit config path overrides auto-discovered', () => {
      const dir = path.join(tmpDir, 'explicit');
      fs.mkdirSync(dir, { recursive: true });

      // Auto-discovered (will be overridden by explicit)
      fs.writeFileSync(
        path.join(dir, '.ebook-ingest.json'),
        JSON.stringify({ model: 'auto-model', vault: '/auto/vault' }),
        'utf-8',
      );

      // Explicit
      const explicitPath = path.join(dir, 'custom.json');
      fs.writeFileSync(
        explicitPath,
        JSON.stringify({ model: 'explicit-model' }),
        'utf-8',
      );

      const config = loadConfig(dir, explicitPath);
      // Explicit wins for model
      expect(config.model).toBe('explicit-model');
      // Auto value for vault (not overridden by explicit)
      expect(config.vault).toBe('/auto/vault');
      // Non-overridden values keep defaults
      expect(config.sourcesDir).toBe(defaultConfig.sourcesDir);
    });

    it('explicit config without auto-discovery still works', () => {
      const dir = path.join(tmpDir, 'explicit-only');
      fs.mkdirSync(dir, { recursive: true });
      const explicitPath = path.join(dir, 'my-config.json');
      fs.writeFileSync(
        explicitPath,
        JSON.stringify({ vault: '/explicit/vault' }),
        'utf-8',
      );
      const config = loadConfig(dir, explicitPath);
      expect(config.vault).toBe('/explicit/vault');
      expect(config.model).toBe(defaultConfig.model);
    });

    it('warns on invalid JSON but returns defaults', () => {
      const dir = path.join(tmpDir, 'invalid');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.ebook-ingest.json'),
        'not-valid-json',
        'utf-8',
      );
      const warn = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      const config = loadConfig(dir);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
      // Should still return defaults
      expect(config.model).toBe(defaultConfig.model);
    });
  });
});
