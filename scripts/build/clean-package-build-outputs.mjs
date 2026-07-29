import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { readRepositoryRoot } from '../lib/repository-root.mjs';

export function cleanPackageBuildOutputs(repositoryRoot) {
  const packagesRoot = join(repositoryRoot, 'packages');
  if (!existsSync(packagesRoot)) {
    return;
  }

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    for (const outputDirectoryName of ['browser-dist', 'dist']) {
      rmSync(join(packagesRoot, entry.name, outputDirectoryName), { force: true, recursive: true });
    }
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  cleanPackageBuildOutputs(readRepositoryRoot(import.meta.url, 2));
}
