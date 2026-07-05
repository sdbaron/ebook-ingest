import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConceptMergeEngine, MergeCandidate } from '../src/concept-merge-engine.js';
import { RegistryManager } from '../src/registry-manager.js';

describe('ConceptMergeEngine', () => {
  let tmpDir: string;
  let conceptDir: string;
  let sourcesDir: string;
  let conceptRegPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ebook-ingest-merge-'));
    conceptDir = path.resolve(tmpDir, '02_concepts');
    sourcesDir = path.resolve(tmpDir, '05_sources');
    conceptRegPath = path.resolve(tmpDir, 'concept_registry.json');

    await fs.mkdir(conceptDir, { recursive: true });
    await fs.mkdir(sourcesDir, { recursive: true });
    await fs.writeFile(conceptRegPath, '{}', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createConceptFile(name: string, content?: string): Promise<void> {
    const md = content || `---
type: concept
---

# ${name}

## Definition
Test definition for ${name}.

## Mentioned in
- [[TestSource]]
`;
    await fs.writeFile(path.resolve(conceptDir, `${name}.md`), md, 'utf-8');
  }

  describe('findCandidates', () => {
    it('returns empty array when no concepts exist', async () => {
      const engine = new ConceptMergeEngine(conceptDir, conceptRegPath, sourcesDir);
      const candidates = await engine.findCandidates();
      expect(candidates).toEqual([]);
    });

    it('returns empty array with single concept', async () => {
      await createConceptFile('Single_Concept');
      const engine = new ConceptMergeEngine(conceptDir, conceptRegPath, sourcesDir);
      const candidates = await engine.findCandidates();
      expect(candidates).toEqual([]);
    });

    it('finds exact normalized matches', async () => {
      await createConceptFile('Dependency Inversion');
      await createConceptFile('dependency  inversion');

      const engine = new ConceptMergeEngine(conceptDir, conceptRegPath, sourcesDir);
      const candidates = await engine.findCandidates();

      expect(candidates.length).toBe(1);
      expect(candidates[0].score).toBe(1.0);
      expect(candidates[0].method).toBe('exact_normalized');
    });

    it('finds acronym matches (DIP ↔ Dependency_Inversion_Principle)', async () => {
      await createConceptFile('DIP');
      await createConceptFile('Dependency_Inversion_Principle');

      const engine = new ConceptMergeEngine(conceptDir, conceptRegPath, sourcesDir);
      const candidates = await engine.findCandidates();

      expect(candidates.length).toBe(1);
      expect(candidates[0].method).toBe('acronym');
      expect(candidates[0].score).toBe(0.9);
      expect(candidates[0].suggestedPrimary).toBe('Dependency_Inversion_Principle');
      expect(candidates[0].suggestedAlias).toBe('DIP');
    });

    it('finds SRP ↔ Single_Responsibility_Principle', async () => {
      await createConceptFile('SRP');
      await createConceptFile('Single_Responsibility_Principle');

      const engine = new ConceptMergeEngine(conceptDir, conceptRegPath, sourcesDir);
      const candidates = await engine.findCandidates();

      expect(candidates.length).toBe(1);
      expect(candidates[0].concepts).toContain('SRP');
      expect(candidates[0].concepts).toContain('Single_Responsibility_Principle');
    });

    it('does not match unrelated concepts as acronyms', async () => {
      await createConceptFile('ABC');
      await createConceptFile('Unrelated_Concept_Name');

      const engine = new ConceptMergeEngine(conceptDir, conceptRegPath, sourcesDir);
      const candidates = await engine.findCandidates();

      // ABC has 3 letters, but Unrelated_Concept_Name has 3 words
      // A = U, B = C, C = N → "UCN" ≠ "ABC" → no match
      const acronymCandidates = candidates.filter(c => c.method === 'acronym');
      expect(acronymCandidates).toEqual([]);
    });
  });

  describe('merge', () => {
    it('creates a redirect file for the alias', async () => {
      await createConceptFile('SRP');
      await createConceptFile('Single_Responsibility_Principle');

      const engine = new ConceptMergeEngine(conceptDir, conceptRegPath, sourcesDir);

      const candidate: MergeCandidate = {
        concepts: ['SRP', 'Single_Responsibility_Principle'],
        score: 0.9,
        method: 'acronym',
        suggestedPrimary: 'Single_Responsibility_Principle',
        suggestedAlias: 'SRP',
      };

      await engine.merge([candidate]);

      // Check redirect file exists
      const redirectPath = path.resolve(conceptDir, 'SRP.md');
      const redirectContent = await fs.readFile(redirectPath, 'utf-8');
      expect(redirectContent).toContain('concept_redirect');
      expect(redirectContent).toContain('redirect_to: Single_Responsibility_Principle');
      expect(redirectContent).toContain('[[Single_Responsibility_Principle]]');
    });

    it('updates registry entries', async () => {
      // Setup registry with both concepts
      const registry = {
        'SRP': { sources: ['Clean_Code'], books: ['Clean_Code'] },
        'Single_Responsibility_Principle': { sources: ['Agile_Principles'], books: [] },
      };
      await fs.writeFile(conceptRegPath, JSON.stringify(registry, null, 2), 'utf-8');

      await createConceptFile('SRP');
      await createConceptFile('Single_Responsibility_Principle');

      const engine = new ConceptMergeEngine(conceptDir, conceptRegPath, sourcesDir);

      const candidate: MergeCandidate = {
        concepts: ['SRP', 'Single_Responsibility_Principle'],
        score: 0.9,
        method: 'acronym',
        suggestedPrimary: 'Single_Responsibility_Principle',
        suggestedAlias: 'SRP',
      };

      await engine.merge([candidate]);

      const updated = await RegistryManager.load<Record<string, any>>(conceptRegPath);

      // Primary has merged sources
      expect(updated['Single_Responsibility_Principle'].sources).toContain('Clean_Code');
      expect(updated['Single_Responsibility_Principle'].sources).toContain('Agile_Principles');
      expect(updated['Single_Responsibility_Principle'].aliases).toContain('SRP');

      // Alias is nulled out
      expect(updated['SRP']).toBeNull();
    });

    it('updates wikilinks in source files', async () => {
      await createConceptFile('SRP');
      await createConceptFile('Single_Responsibility_Principle');

      // Create a source file with [[SRP]] link
      const sourceDir = path.resolve(sourcesDir, 'TestBook');
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(
        path.resolve(sourceDir, '01.md'),
        '## Concepts\n- [[SRP]]\n- [[Other_Concept]]',
        'utf-8',
      );

      const engine = new ConceptMergeEngine(conceptDir, conceptRegPath, sourcesDir);

      const candidate: MergeCandidate = {
        concepts: ['SRP', 'Single_Responsibility_Principle'],
        score: 0.9,
        method: 'acronym',
        suggestedPrimary: 'Single_Responsibility_Principle',
        suggestedAlias: 'SRP',
      };

      await engine.merge([candidate]);

      // Check that wikilink was updated
      const updatedContent = await fs.readFile(path.resolve(sourceDir, '01.md'), 'utf-8');
      expect(updatedContent).toContain('[[Single_Responsibility_Principle|SRP]]');
      expect(updatedContent).toContain('[[Other_Concept]]');
      expect(updatedContent).not.toContain('[[SRP]]');
    });

    it('deduplicates candidates by concept pair', async () => {
      await createConceptFile('DIP');
      await createConceptFile('Dependency_Inversion_Principle');

      const engine = new ConceptMergeEngine(conceptDir, conceptRegPath, sourcesDir);
      const candidates = await engine.findCandidates();

      // Each pair should appear only once
      const pairKeys = candidates.map(c => c.concepts.sort().join('|'));
      expect(pairKeys.length).toBe(new Set(pairKeys).size);
    });
  });
});
