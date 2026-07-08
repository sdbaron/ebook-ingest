import type { WikiNoteType } from './config.js';

/**
 * Result of frontmatter validation against WIKI_CONTENT_STANDARD.md rules.
 */
export interface FrontmatterValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_TYPES = new Set<WikiNoteType>([
  'concept', 'book', 'author', 'pattern', 'standard', 'decision', 'index',
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a frontmatter object against WIKI_CONTENT_STANDARD.md.
 *
 * Mirrors the validation in `packages/wiki-indexer` so that
 * ebook-ingest can self-check before writing.
 */
export class FrontmatterValidator {
  static validate(
    frontmatter: Record<string, unknown>,
  ): FrontmatterValidationResult {
    const errors: string[] = [];

    // title: string, not empty
    if (typeof frontmatter.title !== 'string' || frontmatter.title.trim() === '') {
      errors.push('title: must be a non-empty string');
    }

    // type: valid enum
    if (!VALID_TYPES.has(frontmatter.type as WikiNoteType)) {
      errors.push(
        `type: must be one of ${[...VALID_TYPES].join('|')}, got "${frontmatter.type}"`,
      );
    }

    // domain: string, not empty
    if (typeof frontmatter.domain !== 'string' || frontmatter.domain.trim() === '') {
      errors.push('domain: must be a non-empty string');
    }

    // owner: string, not empty
    if (typeof frontmatter.owner !== 'string' || frontmatter.owner.trim() === '') {
      errors.push('owner: must be a non-empty string');
    }

    // created: YYYY-MM-DD
    if (typeof frontmatter.created !== 'string' || !DATE_RE.test(frontmatter.created)) {
      errors.push('created: must be YYYY-MM-DD');
    }

    // updated: YYYY-MM-DD
    if (typeof frontmatter.updated !== 'string' || !DATE_RE.test(frontmatter.updated)) {
      errors.push('updated: must be YYYY-MM-DD');
    }

    // updated_at: YYYY-MM-DD
    if (typeof frontmatter.updated_at !== 'string' || !DATE_RE.test(frontmatter.updated_at)) {
      errors.push('updated_at: must be YYYY-MM-DD');
    }

    // updated === updated_at
    if (
      typeof frontmatter.updated === 'string' &&
      typeof frontmatter.updated_at === 'string' &&
      frontmatter.updated !== frontmatter.updated_at
    ) {
      errors.push(`updated (${frontmatter.updated}) must equal updated_at (${frontmatter.updated_at})`);
    }

    // tags: array, ≥1 entry
    if (!Array.isArray(frontmatter.tags) || frontmatter.tags.length < 1) {
      errors.push('tags: must be an array with at least one entry');
    }

    // aliases: array (empty allowed)
    if (!Array.isArray(frontmatter.aliases)) {
      errors.push('aliases: must be an array');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Parse a simple YAML frontmatter string into a Record.
   * Handles flow arrays like [a, b] and [] correctly.
   */
  static parseSimpleYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim();
      let rawValue = line.slice(colonIdx + 1).trim();

      // Parse YAML flow arrays: [a, b, c] or []
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        const inner = rawValue.slice(1, -1).trim();
        if (inner.length === 0) {
          result[key] = [];
        } else {
          result[key] = inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        }
        continue;
      }

      // Parse YAML block lists: key with empty value followed by indented - items
      if (rawValue === '' || rawValue === '|' || rawValue === '>') {
        // Check if next lines are indented list items (starting with "  -")
        const items: string[] = [];
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];
          const itemMatch = nextLine.match(/^\s+-\s+(.+)/);
          if (itemMatch) {
            items.push(itemMatch[1].trim().replace(/^["']|["']$/g, ''));
            j++;
          } else {
            break;
          }
        }
        if (items.length > 0) {
          result[key] = items;
          i = j - 1; // skip consumed lines
          continue;
        }
        // Empty scalar — still set it
        result[key] = '';
        continue;
      }

      // Scalar values: strip quotes
      let value: unknown = rawValue.replace(/^["']|["']$/g, '');
      if (/^\d+$/.test(value as string)) value = Number(value);
      if ((value as string).toLowerCase() === 'true') value = true;
      if ((value as string).toLowerCase() === 'false') value = false;

      result[key] = value;
    }

    return result;
  }
}
