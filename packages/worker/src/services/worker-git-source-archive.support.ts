import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function readExtractedRepositoryRoot(extractionDirectory: string): Promise<string> {
  const entries: Dirent[] = await readdir(extractionDirectory, { withFileTypes: true });
  const root: Dirent | undefined = entries.find((entry: Dirent): boolean => entry.isDirectory());
  if (root === undefined) {
    throw new Error('GitHub repository archive did not contain a repository root directory.');
  }

  return join(extractionDirectory, root.name);
}
