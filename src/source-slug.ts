/**
 * Normalize a human-readable source name into a kebab-case slug
 * suitable for directory and file names.
 *
 * "Clean Architecture"       → "clean-architecture"
 * "Release It! 2nd Ed."      → "release-it-2nd-ed"
 */
export class SourceSlug {
  static toKebabCase(name: string): string {
    return name
      // Decompose accented characters (e.g. ü → u)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Replace non-alphanumeric with hyphens
      .replace(/[^a-z0-9]+/gi, '-')
      // Collapse multiple hyphens
      .replace(/-+/g, '-')
      // Trim leading/trailing hyphens
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      || 'source'; // fallback for edge cases (e.g. name is only symbols)
  }
}
