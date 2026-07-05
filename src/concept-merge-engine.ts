import fs from 'node:fs/promises';
import path from 'node:path';
import { ConceptNormalizer } from './concept-normalizer.js';
import { RegistryManager } from './registry-manager.js';

/**
 * A pair of concept names that are candidates for merging.
 */
export interface MergeCandidate {
  /** The two concept names that may refer to the same thing */
  concepts: [string, string];
  /** Similarity score (0–1), higher = more similar */
  score: number;
  /** Method that found this match */
  method: 'exact_normalized' | 'llm_semantic' | 'acronym';
  /** Suggested primary name (the longer/more descriptive one) */
  suggestedPrimary: string;
  /** Suggested alias (the shorter/abbreviated one) */
  suggestedAlias: string;
}

/**
 * Result of a merge operation.
 */
export interface MergeResult {
  /** The primary concept name that was kept */
  primary: string;
  /** Concepts that were merged into the primary */
  merged: string[];
  /** Aliases registered */
  aliases: string[];
}

/**
 * Interface for LLM-based similarity checking.
 * Avoids requiring the LLMAnalyzer directly.
 */
export interface SimilarityChecker {
  checkSimilarity(conceptA: string, conceptB: string): Promise<{ same: boolean; confidence: number }>;
}

/**
 * Detects and merges synonym/duplicate concepts in the vault.
 *
 * Uses three strategies:
 * 1. Exact match after normalization
 * 2. Acronym detection (DIP ↔ Dependency_Inversion_Principle)
 * 3. LLM-based semantic similarity (optional)
 */
export class ConceptMergeEngine {
  private conceptDir: string;
  private conceptRegistryPath: string;
  private sourcesDir: string;
  private similarityChecker?: SimilarityChecker;

  constructor(
    conceptDir: string,
    conceptRegistryPath: string,
    sourcesDir: string,
    similarityChecker?: SimilarityChecker,
  ) {
    this.conceptDir = conceptDir;
    this.conceptRegistryPath = conceptRegistryPath;
    this.sourcesDir = sourcesDir;
    this.similarityChecker = similarityChecker;
  }

  /**
   * Find all merge candidates across the concept directory.
   * Returns candidates sorted by score (highest first).
   */
  async findCandidates(): Promise<MergeCandidate[]> {
    const concepts = await this.listConcepts();
    if (concepts.length < 2) return [];

    const allCandidates: MergeCandidate[] = [];

    // Strategy 1: Exact normalized matches
    allCandidates.push(...this.findExactMatches(concepts));

    // Strategy 2: Acronym detection
    allCandidates.push(...this.findAcronymMatches(concepts));

    // Strategy 3: LLM-based semantic similarity
    if (this.similarityChecker) {
      const semanticMatches = await this.findSemanticMatches(concepts);
      allCandidates.push(...semanticMatches);
    }

    // Deduplicate and sort by score descending
    return this.deduplicateAndSort(allCandidates);
  }

  /**
   * Execute merges for the given candidates.
   */
  async merge(candidates: MergeCandidate[]): Promise<MergeResult[]> {
    const results: MergeResult[] = [];

    for (const candidate of candidates) {
      const primary = candidate.suggestedPrimary;
      const alias = candidate.suggestedAlias;

      // 1. Create redirect file from alias to primary
      await this.createRedirect(alias, primary);

      // 2. Merge registry entries
      await this.mergeRegistryEntries(primary, alias);

      // 3. Update all wikilinks in the vault
      await this.updateLinks(alias, primary);

      results.push({
        primary,
        merged: [alias],
        aliases: [alias],
      });
    }

    return results;
  }

  // ─── Candidate Finding Strategies ──────────────────────────

  /**
   * Find concepts that are identical after normalization.
   */
  private findExactMatches(concepts: string[]): MergeCandidate[] {
    const normalized = new Map<string, string>();
    const candidates: MergeCandidate[] = [];

    for (const concept of concepts) {
      const norm = ConceptNormalizer.normalize(concept).toLowerCase();
      if (normalized.has(norm)) {
        const existing = normalized.get(norm)!;
        candidates.push({
          concepts: [existing, concept],
          score: 1.0,
          method: 'exact_normalized',
          suggestedPrimary: concept.length > existing.length ? concept : existing,
          suggestedAlias: concept.length > existing.length ? existing : concept,
        });
      } else {
        normalized.set(norm, concept);
      }
    }

    return candidates;
  }

  /**
   * Find acronym matches: e.g. DIP ↔ Dependency_Inversion_Principle.
   */
  private findAcronymMatches(concepts: string[]): MergeCandidate[] {
    const candidates: MergeCandidate[] = [];

    // Concepts that look like acronyms (2-6 uppercase letters)
    const acronyms = concepts.filter(c => /^[A-Z]{2,6}$/.test(c));

    // Multi-word concepts (contain underscores or spaces internally)
    const multiWord = concepts.filter(c =>
      c.includes('_') || (c.includes(' ') && c.length > 5)
    );

    for (const acronym of acronyms) {
      const letters = acronym.split('');
      for (const candidate of multiWord) {
        const words = candidate.split(/[_\s]+/);
        if (words.length === letters.length) {
          const derived = words.map(w => (w[0] || '').toUpperCase()).join('');
          if (derived === acronym) {
            candidates.push({
              concepts: [acronym, candidate],
              score: 0.9,
              method: 'acronym',
              suggestedPrimary: candidate,
              suggestedAlias: acronym,
            });
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Find semantically similar concepts using the LLM similarity checker.
   * Uses pre-filtering to avoid O(n²) LLM calls.
   */
  private async findSemanticMatches(concepts: string[]): Promise<MergeCandidate[]> {
    if (!this.similarityChecker) return [];

    const candidates: MergeCandidate[] = [];
    const pairs = this.filterCandidatePairs(concepts);

    for (const [a, b] of pairs) {
      try {
        const result = await this.similarityChecker.checkSimilarity(a, b);
        if (result.same && result.confidence > 0.7) {
          candidates.push({
            concepts: [a, b],
            score: result.confidence,
            method: 'llm_semantic',
            suggestedPrimary: a.length >= b.length ? a : b,
            suggestedAlias: a.length >= b.length ? b : a,
          });
        }
      } catch {
        // Skip failed LLM calls
      }
    }

    return candidates;
  }

  /**
   * Pre-filter concept pairs to avoid comparing all pairs.
   * Only compares concepts with shared word stems or significant character overlap.
   */
  private filterCandidatePairs(concepts: string[]): [string, string][] {
    const pairs: [string, string][] = [];

    for (let i = 0; i < concepts.length; i++) {
      for (let j = i + 1; j < concepts.length; j++) {
        if (this.hasSharedStem(concepts[i], concepts[j])) {
          pairs.push([concepts[i], concepts[j]]);
        }
      }
    }

    return pairs;
  }

  /**
   * Check if two concept names share a significant word stem.
   */
  private hasSharedStem(a: string, b: string): boolean {
    const aWords = a.toLowerCase().split(/[_\s]+/);
    const bWords = b.toLowerCase().split(/[_\s]+/);

    // Check for shared words of at least 4 characters
    for (const wa of aWords) {
      if (wa.length < 4) continue;
      for (const wb of bWords) {
        if (wb.length < 4) continue;
        if (wa === wb || wa.startsWith(wb) || wb.startsWith(wa)) {
          return true;
        }
      }
    }

    // Character overlap: at least 50% shared characters
    const aChars = new Set(a.toLowerCase().replace(/[_\s]/g, ''));
    const bChars = new Set(b.toLowerCase().replace(/[_\s]/g, ''));
    const intersection = new Set([...aChars].filter(c => bChars.has(c)));
    const union = new Set([...aChars, ...bChars]);

    return intersection.size / union.size >= 0.5;
  }

  // ─── Merge Operations ──────────────────────────────────────

  /**
   * Create a redirect markdown file from alias to primary.
   */
  private async createRedirect(alias: string, primary: string): Promise<void> {
    const aliasPath = path.resolve(this.conceptDir, `${alias}.md`);

    const content = `---
type: concept_redirect
redirect_to: ${primary}
---

# ${alias}

> This concept has been merged into [[${primary}]].
`;

    await fs.writeFile(aliasPath, content, 'utf-8');
  }

  /**
   * Merge registry entries: move sources from alias to primary, add alias info.
   */
  private async mergeRegistryEntries(primary: string, alias: string): Promise<void> {
    const registry = await RegistryManager.load<Record<string, {
      sources?: string[];
      books?: string[];
      aliases?: string[];
      merged_from?: string[];
    }>>(this.conceptRegistryPath);

    const primaryEntry = registry[primary] || { sources: [], books: [] };
    const aliasEntry = registry[alias];

    if (aliasEntry) {
      // Merge sources
      if (aliasEntry.sources) {
        primaryEntry.sources = [
          ...new Set([...(primaryEntry.sources || []), ...aliasEntry.sources]),
        ];
      }
      if (aliasEntry.books) {
        primaryEntry.books = [
          ...new Set([...(primaryEntry.books || []), ...aliasEntry.books]),
        ];
      }

      // Add alias info
      primaryEntry.aliases = [...new Set([...(primaryEntry.aliases || []), alias])];
      primaryEntry.merged_from = [...new Set([...(primaryEntry.merged_from || []), alias])];
    }

    registry[primary] = primaryEntry;

    // Mark alias as merged (null = merged away)
    registry[alias] = null as unknown as typeof primaryEntry;

    await RegistryManager.save(this.conceptRegistryPath, registry);
  }

  /**
   * Update all wikilinks: replace [[Alias]] with [[Primary|Alias]].
   */
  private async updateLinks(alias: string, primary: string): Promise<void> {
    // Update links in all concept files
    await this.updateLinksInDir(this.conceptDir, alias, primary);

    // Update links in source directories
    await this.updateLinksInDir(this.sourcesDir, alias, primary);
  }

  /**
   * Recursively update wikilinks in a directory.
   */
  private async updateLinksInDir(
    dir: string,
    alias: string,
    primary: string,
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Directory doesn't exist
    }

    for (const entry of entries) {
      const fullPath = path.resolve(dir, entry.name);

      if (entry.isDirectory()) {
        await this.updateLinksInDir(fullPath, alias, primary);
      } else if (entry.name.endsWith('.md')) {
        // Skip redirect files
        if (entry.name === `${alias}.md` && dir === this.conceptDir) continue;

        const content = await fs.readFile(fullPath, 'utf-8');

        // Replace [[Alias]] with [[Primary|Alias]]
        // But NOT [[Alias|something]] (already has a display text)
        const updated = content.replace(
          new RegExp(`\\[\\[${escapeRegex(alias)}\\]\\]`, 'g'),
          `[[${primary}|${alias}]]`,
        );

        if (updated !== content) {
          await fs.writeFile(fullPath, updated, 'utf-8');
        }
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────

  /**
   * List all concept names from the concept directory.
   */
  private async listConcepts(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.conceptDir);
      return files
        .filter(f => f.endsWith('.md'))
        .map(f => f.replace(/\.md$/, ''));
    } catch {
      return [];
    }
  }

  /**
   * Deduplicate candidates and sort by score descending.
   */
  private deduplicateAndSort(candidates: MergeCandidate[]): MergeCandidate[] {
    const seen = new Set<string>();
    const unique: MergeCandidate[] = [];

    for (const c of candidates) {
      const key = [c.concepts[0], c.concepts[1]].sort().join('|||');
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(c);
      }
    }

    return unique.sort((a, b) => b.score - a.score);
  }
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
