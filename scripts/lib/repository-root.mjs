import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readRepositoryRoot(importMetaUrl, levelsUp = 1) {
  const scriptDirectory = dirname(fileURLToPath(importMetaUrl));
  return resolve(scriptDirectory, ...Array.from({ length: levelsUp }, () => '..'));
}
