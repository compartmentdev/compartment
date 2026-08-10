import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

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

runMain(import.meta.url, process.argv[1], () => {
  cleanPackageBuildOutputs(readRepositoryRoot(import.meta.url, 2));
});
