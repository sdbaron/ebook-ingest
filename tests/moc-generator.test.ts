import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MocGenerator, ConceptVector, ConceptCluster } from '../src/moc-generator.js';
import { EmbeddingGenerator } from '../src/embedding-generator.js';

describe('MocGenerator', () => {
  let tmpDir: string;
  let conceptsDir: string;
  let mocDir: string;
  let sourceRegPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ebook-ingest-moc-'));
    conceptsDir = path.resolve(tmpDir, '02_concepts');
    mocDir = path.resolve(tmpDir, '04_mocs');
    sourceRegPath = path.resolve(tmpDir, 'source_registry.json');

    await fs.mkdir(conceptsDir, { recursive: true });
    await fs.mkdir(mocDir, { recursive: true });
    await fs.writeFile(sourceRegPath, '{}', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeGenerator(): MocGenerator {
    const embGen = new EmbeddingGenerator('nomic-embed-text');
    return new MocGenerator(embGen, conceptsDir, mocDir, sourceRegPath, 'llama3.2');
  }

  describe('cluster', () => {
    it('clusters concepts into groups', () => {
      const gen = makeGenerator();

      const concepts: ConceptVector[] = [
        { conceptName: 'Dependency_Inversion', embedding: [0.9, 0.1, 0.0], definition: '', sourceCount: 2 },
        { conceptName: 'Single_Responsibility', embedding: [0.8, 0.2, 0.1], definition: '', sourceCount: 3 },
        { conceptName: 'Coupling', embedding: [0.85, 0.15, 0.05], definition: '', sourceCount: 2 },
        { conceptName: 'Unit_Testing', embedding: [0.1, 0.9, 0.0], definition: '', sourceCount: 1 },
        { conceptName: 'Integration_Testing', embedding: [0.15, 0.85, 0.1], definition: '', sourceCount: 1 },
        { conceptName: 'TDD', embedding: [0.1, 0.8, 0.2], definition: '', sourceCount: 2 },
      ];

      const result = gen.cluster(concepts, 2);

      expect(result.clusters).toHaveLength(2);
      expect(result.silhouetteScore).toBeGreaterThan(-1);
      expect(result.silhouetteScore).toBeLessThanOrEqual(1);
    });

    it('handles fewer concepts than requested clusters', () => {
      const gen = makeGenerator();

      const concepts: ConceptVector[] = [
        { conceptName: 'A', embedding: [1, 0], definition: '', sourceCount: 1 },
        { conceptName: 'B', embedding: [0, 1], definition: '', sourceCount: 1 },
      ];

      const result = gen.cluster(concepts, 5);
      expect(result.clusters.length).toBeLessThanOrEqual(2);
    });

    it('returns silhouette score between -1 and 1', () => {
      const gen = makeGenerator();

      const concepts: ConceptVector[] = [
        { conceptName: 'A', embedding: [1, 0, 0], definition: '', sourceCount: 1 },
        { conceptName: 'B', embedding: [0.9, 0.1, 0], definition: '', sourceCount: 1 },
        { conceptName: 'C', embedding: [0, 1, 0], definition: '', sourceCount: 1 },
        { conceptName: 'D', embedding: [0, 0.9, 0.1], definition: '', sourceCount: 1 },
      ];

      const result = gen.cluster(concepts, 2);
      expect(result.silhouetteScore).toBeGreaterThanOrEqual(-1);
      expect(result.silhouetteScore).toBeLessThanOrEqual(1);
    });

    it('auto-determines K when not specified', () => {
      const gen = makeGenerator();

      const concepts: ConceptVector[] = Array.from({ length: 6 }, (_, i) => ({
        conceptName: `Concept_${i}`,
        embedding: [Math.random(), Math.random(), Math.random()],
        definition: '',
        sourceCount: 1,
      }));

      const result = gen.cluster(concepts);
      expect(result.clusters.length).toBeGreaterThanOrEqual(2);
      expect(result.clusters.length).toBeLessThanOrEqual(concepts.length);
    });
  });

  describe('writeMocs', () => {
    it('creates MOC markdown files for clusters', async () => {
      const gen = makeGenerator();

      const clusters: ConceptCluster[] = [
        {
          label: 'Software_Design',
          concepts: ['Dependency_Inversion', 'Single_Responsibility'],
          centroid: [1, 0],
        },
        {
          label: 'Testing',
          concepts: ['Unit_Testing', 'TDD'],
          centroid: [0, 1],
        },
      ];

      await gen.writeMocs(clusters);

      // Check files were created
      const files = await fs.readdir(mocDir);
      expect(files.length).toBeGreaterThanOrEqual(2);

      const swDesignPath = path.resolve(mocDir, 'Software_Design.md');
      const content = await fs.readFile(swDesignPath, 'utf-8');
      expect(content).toContain('type: moc');
      expect(content).toContain('# Software_Design');
      expect(content).toContain('[[Dependency_Inversion]]');
      expect(content).toContain('[[Single_Responsibility]]');
    });
  });
});
