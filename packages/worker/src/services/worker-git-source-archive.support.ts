import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function readExtractedRepositoryRoot(extractionDirectory: string): Promise<string> {
  const entries: Dirent[] = await readdir(extractionDirectory, { withFileTypes: true });
  const roots: Dirent[] = entries.filter((entry: Dirent): boolean => entry.isDirectory());
  const [root]: Dirent[] = roots;
  if (root === undefined) {
    throw new Error('Git provider repository archive did not contain a repository root directory.');
  }
  if (roots.length > 1) {
    throw new Error('Git provider repository archive contained multiple repository root directories.');
  }

  return join(extractionDirectory, root.name);
}
