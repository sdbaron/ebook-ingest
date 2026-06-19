import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * JSON-based registry for tracking concepts and books.
 */
export class RegistryManager {
  /**
   * Ensure meta directory and registry files exist.
   */
  static async ensure(
    metaDir: string,
    conceptRegistry: string,
    bookRegistry: string,
  ): Promise<void> {
    await fs.mkdir(metaDir, { recursive: true });

    for (const filePath of [conceptRegistry, bookRegistry]) {
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, JSON.stringify({}, null, 2), 'utf-8');
      }
    }
  }

  /**
   * Load a JSON registry file.
   */
  static async load<T = Record<string, unknown>>(filePath: string): Promise<T> {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  }

  /**
   * Save a JSON registry file.
   */
  static async save<T>(filePath: string, data: T): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  /**
   * Get the absolute path for a registry file within the vault.
   */
  static registryPath(vault: string, relativePath: string): string {
    return path.resolve(vault, relativePath);
  }
}
