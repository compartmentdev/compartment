import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { readRepoLocalTsxCliPath } from '../lib/tsx-cli.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const cliTsconfigPath = resolve(repositoryRoot, 'packages/cli/tsconfig.json');
const cliEntrypointPath = resolve(repositoryRoot, 'packages/cli/src/bin.ts');
const tsxEntrypointPath = readRepoLocalTsxCliPath();
const executionCwd = process.cwd();

const result = spawnSync(
  process.execPath,
  [tsxEntrypointPath, '--tsconfig', cliTsconfigPath, cliEntrypointPath, ...process.argv.slice(2)],
  {
    cwd: executionCwd,
    env: {
      ...process.env,
      INIT_CWD: executionCwd,
      PWD: executionCwd,
    },
    stdio: 'inherit',
  },
);

if (result.error !== undefined) {
  throw result.error;
}

if (result.signal !== null) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 1);
}
