import fs from 'node:fs/promises';
import path from 'node:path';
import ollama from 'ollama';
import { EmbeddingGenerator } from './embedding-generator.js';

/**
 * A concept with its embedding vector and metadata.
 */
export interface ConceptVector {
  conceptName: string;
  embedding: number[];
  definition: string;
  sourceCount: number;
}

/**
 * A cluster of related concepts.
 */
export interface ConceptCluster {
  label: string;
  concepts: string[];
  centroid: number[];
}

/**
 * Result of the clustering operation.
 */
export interface ClusterResult {
  clusters: ConceptCluster[];
  silhouetteScore: number;
}

/**
 * Generates Maps of Content (MOCs) automatically by clustering
 * concept embeddings and creating overview pages.
 */
export class MocGenerator {
  private embeddingGenerator: EmbeddingGenerator;
  private conceptsDir: string;
  private mocDir: string;
  private sourceRegistryPath: string;
  private llmModel: string;
  private lastSilhouetteScore: number = 0;

  constructor(
    embeddingGenerator: EmbeddingGenerator,
    conceptsDir: string,
    mocDir: string,
    sourceRegistryPath: string,
    llmModel: string,
  ) {
    this.embeddingGenerator = embeddingGenerator;
    this.conceptsDir = conceptsDir;
    this.mocDir = mocDir;
    this.sourceRegistryPath = sourceRegistryPath;
    this.llmModel = llmModel;
  }

  /**
   * Full pipeline: vectorize → cluster → label → write MOCs.
   */
  async generate(numClusters?: number): Promise<void> {
    console.log('[MOC] Vectorizing concepts...');
    const concepts = await this.vectorizeConcepts();

    if (concepts.length < 3) {
      console.log('[MOC] Too few concepts for clustering (need >= 3). Skipping.');
      return;
    }

    console.log(`[MOC] Clustering ${concepts.length} concepts...`);
    const result = this.cluster(concepts, numClusters);
    this.lastSilhouetteScore = result.silhouetteScore;

    console.log(`[MOC] ${result.clusters.length} clusters (silhouette: ${result.silhouetteScore.toFixed(2)})`);

    console.log('[MOC] Generating cluster labels...');
    await this.generateClusterLabels(result.clusters);

    console.log('[MOC] Writing MOC files...');
    await this.writeMocs(result.clusters);

    console.log('[MOC] Done.');
  }

  /**
   * Generate embeddings for all concepts in the vault.
   */
  async vectorizeConcepts(): Promise<ConceptVector[]> {
    const files = await this.listConceptFiles();
    const vectors: ConceptVector[] = [];

    for (const fileName of files) {
      const conceptName = fileName.replace(/\.md$/, '');
      try {
        const richText = await this.buildConceptText(conceptName, fileName);
        const embedding = await this.embeddingGenerator.embedQuery(richText);

        vectors.push({
          conceptName,
          embedding,
          definition: richText.slice(0, 200),
          sourceCount: (richText.match(/\[\[/g) || []).length,
        });
      } catch (err) {
        console.warn(`[MOC] Skipping concept "${conceptName}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return vectors;
  }

  /**
   * Cluster concepts into thematic groups using K-Means.
   */
  cluster(concepts: ConceptVector[], numClusters?: number): ClusterResult {
    const vectors = concepts.map(c => c.embedding);
    const k = numClusters || this.findOptimalK(vectors);
    const actualK = Math.min(k, concepts.length);

    // Initialize centroids using k-means++
    let centroids = this.initializeCentroids(vectors, actualK);

    // Iterative optimization
    const maxIterations = 100;
    let assignments: number[] = [];

    for (let iter = 0; iter < maxIterations; iter++) {
      // Assign each point to nearest centroid
      assignments = vectors.map(v => this.closestCentroid(v, centroids));

      // Recompute centroids
      const newCentroids = this.recomputeCentroids(vectors, assignments, actualK);

      if (this.centroidsEqual(centroids, newCentroids)) break;
      centroids = newCentroids;
    }

    // Build cluster objects
    const clusters = this.buildClusters(concepts, assignments, centroids);

    // Calculate silhouette score
    const silhouetteScore = this.calculateSilhouette(vectors, assignments, centroids);

    return { clusters, silhouetteScore };
  }

  /**
   * Generate human-readable labels for each cluster using the LLM.
   */
  private async generateClusterLabels(clusters: ConceptCluster[]): Promise<void> {
    for (const cluster of clusters) {
      try {
        cluster.label = await this.llmLabel(cluster.concepts);
      } catch {
        cluster.label = this.fallbackLabel(cluster.concepts);
      }
    }
  }

  /**
   * Write MOC markdown files from clusters.
   */
  async writeMocs(clusters: ConceptCluster[]): Promise<void> {
    await fs.mkdir(this.mocDir, { recursive: true });

    for (const cluster of clusters) {
      const fileName = cluster.label
        .replace(/[^A-Za-z0-9ÄÖÜäöüß_ ]/g, '')
        .replace(/\s+/g, '_') + '.md';

      const conceptLinks = [...cluster.concepts].sort()
        .map(c => `- [[${c}]]`)
        .join('\n');

      const overviewRows = await this.buildOverviewRows(cluster.concepts);

      const md = `---
type: moc
generated: ${new Date().toISOString()}
cluster_size: ${cluster.concepts.length}
silhouette_score: ${this.lastSilhouetteScore.toFixed(2)}
---

# ${cluster.label}

> Auto-generated MOC — ${cluster.concepts.length} concepts clustered together.

## Concepts

${conceptLinks}

## Cluster Overview

| Concept | Sources |
|---|---|
${overviewRows}
`;

      const filePath = path.resolve(this.mocDir, fileName);
      await fs.writeFile(filePath, md, 'utf-8');
      console.log(`[MOC] Written: ${fileName}`);
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────

  private async listConceptFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.conceptsDir);
      return entries.filter(f => f.endsWith('.md'));
    } catch {
      return [];
    }
  }

  /**
   * Build a rich text representation of a concept for embedding.
   */
  private async buildConceptText(conceptName: string, fileName: string): Promise<string> {
    const filePath = path.resolve(this.conceptsDir, fileName);
    const content = await fs.readFile(filePath, 'utf-8');

    // Extract definition section
    const defMatch = content.match(/## Definition\n([\s\S]*?)(?=\n## |$)/);
    const definition = defMatch ? defMatch[1].trim() : '';

    // Extract mentioned sources
    const sourceMatch = content.match(/## Mentioned in\n([\s\S]*?)$/);
    const sources = sourceMatch
      ? sourceMatch[1].split('\n').filter(l => l.startsWith('- [[')).join(' ')
      : '';

    return `${conceptName.replace(/_/g, ' ')}: ${definition} ${sources}`;
  }

  // ─── K-Means Implementation ──────────────────────────────────

  private closestCentroid(vector: number[], centroids: number[][]): number {
    let minDist = Infinity;
    let minIndex = 0;

    for (let i = 0; i < centroids.length; i++) {
      const dist = 1 - this.cosineSimilarity(vector, centroids[i]);
      if (dist < minDist) {
        minDist = dist;
        minIndex = i;
      }
    }

    return minIndex;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private initializeCentroids(vectors: number[][], k: number): number[][] {
    const centroids: number[][] = [];

    // First centroid: random point
    centroids.push([...vectors[Math.floor(Math.random() * vectors.length)]]);

    // Remaining centroids: k-means++ initialization
    for (let c = 1; c < k; c++) {
      const distances = vectors.map(v => {
        let minDist = Infinity;
        for (const centroid of centroids) {
          const d = 1 - this.cosineSimilarity(v, centroid);
          if (d < minDist) minDist = d;
        }
        return minDist * minDist; // D² weighting
      });

      const totalDist = distances.reduce((a, b) => a + b, 0);
      let r = Math.random() * totalDist;
      let selectedIndex = distances.length - 1;

      for (let i = 0; i < distances.length; i++) {
        r -= distances[i];
        if (r <= 0) {
          selectedIndex = i;
          break;
        }
      }

      centroids.push([...vectors[selectedIndex]]);
    }

    return centroids;
  }

  private recomputeCentroids(
    vectors: number[][],
    assignments: number[],
    k: number,
  ): number[][] {
    const centroids: number[][] = Array.from({ length: k }, () =>
      new Array(vectors[0]?.length || 0).fill(0),
    );
    const counts: number[] = new Array(k).fill(0);

    for (let i = 0; i < vectors.length; i++) {
      const cluster = assignments[i];
      counts[cluster]++;
      for (let j = 0; j < vectors[i].length; j++) {
        centroids[cluster][j] += vectors[i][j];
      }
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let j = 0; j < centroids[c].length; j++) {
          centroids[c][j] /= counts[c];
        }
      }
    }

    return centroids;
  }

  private centroidsEqual(a: number[][], b: number[][]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (this.cosineSimilarity(a[i], b[i]) < 0.9999) return false;
    }
    return true;
  }

  /**
   * Elbow method for automatic K determination.
   */
  private findOptimalK(vectors: number[][], maxK: number = 10): number {
    if (vectors.length < 4) return 2;

    const k = Math.min(maxK, vectors.length - 1);
    const distortions: number[] = [];

    for (let c = 1; c <= k; c++) {
      const centroids = this.initializeCentroids(vectors, c);
      const assignments = vectors.map(v => this.closestCentroid(v, centroids));
      let distortion = 0;
      for (let i = 0; i < vectors.length; i++) {
        distortion += 1 - this.cosineSimilarity(vectors[i], centroids[assignments[i]]);
      }
      distortions.push(distortion);
    }

    // Find elbow: largest drop in slope
    let maxDiff = 0;
    let elbow = 2;
    for (let i = 1; i < distortions.length - 1; i++) {
      const diff = distortions[i - 1] - 2 * distortions[i] + distortions[i + 1];
      if (diff > maxDiff) {
        maxDiff = diff;
        elbow = i + 1;
      }
    }

    return Math.max(2, elbow);
  }

  private calculateSilhouette(
    vectors: number[][],
    assignments: number[],
    centroids: number[][],
  ): number {
    if (vectors.length < 2) return 0;

    let totalScore = 0;
    for (let i = 0; i < vectors.length; i++) {
      const ownCluster = assignments[i];

      // a(i): mean distance to own cluster
      let aSum = 0;
      let aCount = 0;
      for (let j = 0; j < vectors.length; j++) {
        if (assignments[j] === ownCluster && i !== j) {
          aSum += 1 - this.cosineSimilarity(vectors[i], vectors[j]);
          aCount++;
        }
      }
      const a = aCount > 0 ? aSum / aCount : 0;

      // b(i): min mean distance to other clusters
      let b = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        if (c === ownCluster) continue;
        let bSum = 0;
        let bCount = 0;
        for (let j = 0; j < vectors.length; j++) {
          if (assignments[j] === c) {
            bSum += 1 - this.cosineSimilarity(vectors[i], vectors[j]);
            bCount++;
          }
        }
        if (bCount > 0) {
          b = Math.min(b, bSum / bCount);
        }
      }

      totalScore += (b - a) / Math.max(a, b);
    }

    return totalScore / vectors.length;
  }

  private buildClusters(
    concepts: ConceptVector[],
    assignments: number[],
    centroids: number[][],
  ): ConceptCluster[] {
    const clusters: ConceptCluster[] = centroids.map((centroid, i) => ({
      label: `Cluster ${i + 1}`,
      concepts: [],
      centroid,
    }));

    for (let i = 0; i < concepts.length; i++) {
      clusters[assignments[i]].concepts.push(concepts[i].conceptName);
    }

    return clusters.filter(c => c.concepts.length > 0);
  }

  // ─── LLM Label Generation ────────────────────────────────────

  private async llmLabel(concepts: string[]): Promise<string> {
    const conceptList = concepts
      .map(c => c.replace(/_/g, ' '))
      .join(', ');

    const prompt = `Given these related concepts:
${conceptList}

Suggest a short, descriptive category label (2-4 words) that best groups these concepts.
Return ONLY the label, nothing else.`;

    const response = await ollama.chat({
      model: this.llmModel,
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0.3, num_predict: 20 },
    });

    return response.message.content.trim();
  }

  private fallbackLabel(concepts: string[]): string {
    if (concepts.length === 0) return 'Empty Group';
    if (concepts.length === 1) return concepts[0].replace(/_/g, ' ');

    // Find most frequent word stems
    const words = concepts.flatMap(c => c.toLowerCase().split('_'));
    const freq = new Map<string, number>();
    for (const w of words) {
      if (w.length >= 4) freq.set(w, (freq.get(w) || 0) + 1);
    }

    const topWords = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));

    return topWords.length > 0 ? topWords.join(' & ') : `Concept Group`;
  }

  // ─── MOC Writing ─────────────────────────────────────────────

  private async buildOverviewRows(concepts: string[]): Promise<string> {
    // Try to read source info for each concept
    const rows: string[] = [];

    for (const concept of concepts) {
      try {
        const conceptPath = path.resolve(this.conceptsDir, `${concept}.md`);
        const content = await fs.readFile(conceptPath, 'utf-8');
        const sourceMatch = content.match(/## Mentioned in\n([\s\S]*?)$/);
        if (sourceMatch) {
          const sources = sourceMatch[1]
            .split('\n')
            .filter(l => l.startsWith('-'))
            .map(l => l.replace(/^- \[\[|\]\]$/g, '').trim())
            .join(', ');
          rows.push(`| ${concept} | ${sources || '—'} |`);
        } else {
          rows.push(`| ${concept} | — |`);
        }
      } catch {
        rows.push(`| ${concept} | — |`);
      }
    }

    return rows.join('\n');
  }
}
