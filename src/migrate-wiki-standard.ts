import path from 'node:path';
import fs from 'node:fs/promises';
import { EbookIngestConfig } from './config.js';
import { todayDateOnly } from './date-utils.js';

/**
 * Migrate existing vault notes to WIKI_CONTENT_STANDARD.md compliance.
 *
 * Adds missing frontmatter fields to all notes in 05_sources/** / *.md
 * and 02_concepts/*.md.  Already-compliant notes are skipped (idempotent).
 */
export async function migrateWikiStandard(
  config: EbookIngestConfig,
  dryRun: boolean = false,
): Promise<void> {
  const vault = config.vault;
  const sourcesDir = path.resolve(vault, config.sourcesDir);
  const conceptsDir = path.resolve(vault, config.conceptsDir);

  const updatedFiles: string[] = [];

  // ── Source notes ────────────────────────────────────────────────────
  for (const dir of [sourcesDir, conceptsDir]) {
    const files = await walkMarkdown(dir);
    for (const filePath of files) {
      const content = await fs.readFile(filePath, 'utf-8');
      const newContent = patchFrontmatter(
        content,
        config,
        filePath,
        dir === conceptsDir,
      );
      if (newContent !== content) {
        updatedFiles.push(path.relative(vault, filePath));
        if (!dryRun) {
          await fs.writeFile(filePath, newContent, 'utf-8');
        }
      }
    }
  }

  if (dryRun) {
    console.log(
      `[MIGRATE-WIKI] Dry run — ${updatedFiles.length} file(s) would be updated:`,
    );
    for (const f of updatedFiles) {
      console.log(`  - ${f}`);
    }
  } else {
    console.log(
      `[MIGRATE-WIKI] Updated ${updatedFiles.length} file(s).`,
    );
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

async function walkMarkdown(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await walkMarkdown(fullPath)));
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.md')
      ) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory might not exist
  }
  return results;
}

function patchFrontmatter(
  content: string,
  config: EbookIngestConfig,
  _filePath: string,
  isConcept: boolean,
): string {
  // Match existing YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return content; // No frontmatter — skip

  const fmLines = fmMatch[1].split('\n');
  const existingFields = new Map<string, string>();

  for (const line of fmLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    existingFields.set(key, value);
  }

  // Check which required fields are missing
  const missing: string[] = [];
  const requiredFields = [
    'title', 'type', 'domain', 'owner',
    'created', 'updated', 'updated_at', 'tags', 'aliases',
  ];

  for (const field of requiredFields) {
    if (!existingFields.has(field)) {
      missing.push(field);
    }
  }

  if (missing.length === 0) {
    // All fields present — check if type value is itself invalid
    const existingType = existingFields.get('type') ?? '';
    const invalidLegacyTypes = ['source_block', 'source', 'chapter'];
    if (!invalidLegacyTypes.includes(existingType)) {
      return content; // Truly compliant
    }
    // Fall through: force-repatch the type field
    missing.push('type');
  }

  // Derive values for missing fields
  const sourceType = existingFields.get('source_type') ?? 'epub';
  const now = todayDateOnly();
  const title =
    existingFields.get('title') ??
    path.basename(_filePath, '.md').replace(/_/g, ' ');

  // Determine wiki type
  let wikiType = existingFields.get('type') ?? 'book';
  if (wikiType === 'source_block' || wikiType === 'chapter') wikiType = 'book';
  if (wikiType === 'source') wikiType = 'index';
  if (isConcept) wikiType = 'concept';

  // Build new frontmatter fields; for type, replace existing invalid value
  const newFields: string[] = [];
  // Rebuild all lines excluding fields we need to patch
  const preservedLines = fmLines.filter(
    line => !missing.some(f => line.trimStart().startsWith(`${f}:`)),
  );
  for (const field of missing) {
    switch (field) {
      case 'title':
        newFields.push(`title: ${yamlQuote(title)}`);
        break;
      case 'type':
        newFields.push(`type: ${wikiType}`);
        break;
      case 'domain':
        newFields.push(
          `domain: ${config.wikiStandard.defaultDomain}`,
        );
        break;
      case 'owner':
        newFields.push(
          `owner: ${config.wikiStandard.defaultOwner}`,
        );
        break;
      case 'created':
        newFields.push(`created: "${now}"`);
        break;
      case 'updated':
        newFields.push(`updated: "${now}"`);
        break;
      case 'updated_at':
        newFields.push(`updated_at: "${now}"`);
        break;
      case 'tags':
        newFields.push(
          `tags: [${sourceType}, ${config.wikiStandard.defaultDomain}]`,
        );
        break;
      case 'aliases':
        newFields.push('aliases: []');
        break;
    }
  }

  // Insert new fields after existing (preserved) frontmatter entries
  const newFmLines = [...preservedLines, ...newFields];
  const rest = content.slice(fmMatch[0].length);

  return `---\n${newFmLines.join('\n')}\n---${rest}`;
}

function yamlQuote(value: string): string {
  if (/[:#\"'\n]/.test(value) || value !== value.trim()) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
