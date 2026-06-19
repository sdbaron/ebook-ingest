/**
 * Normalize concept names for use as filenames and wikilinks.
 */
export class ConceptNormalizer {
  /**
   * Normalize a concept name:
   * - Trim whitespace
   * - Replace slashes and spaces with underscores
   * - Remove all characters except A-Z, a-z, 0-9, and underscore
   */
  static normalize(name: string): string {
    let normalized = name.trim();
    normalized = normalized.replace(/\//g, '_');
    normalized = normalized.replace(/\s+/g, '_');
    normalized = normalized.replace(/[^A-Za-z0-9_]/g, '');
    return normalized;
  }
}
