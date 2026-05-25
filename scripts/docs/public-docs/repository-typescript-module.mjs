import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureCommand } from '../../lib/command.mjs';
import { readRepoLocalTsxCliPath } from '../../lib/tsx-cli.mjs';

const TYPESCRIPT_SOURCE_RUNTIME_HINT =
  'This generator still reads repository TypeScript source under `packages/cli` and `packages/contracts`, so it shells through the repo-local `tsx` runtime.';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../..');
const tsxCliPath = readRepoLocalTsxCliPath();
const runnerPath = resolve(repositoryRoot, 'scripts/docs/public-docs/run-typescript-export.mjs');
const scriptsTsconfigPath = resolve(repositoryRoot, 'scripts/tsconfig.json');

export function readRepositoryTypescriptExport(moduleUrl, exportName) {
  try {
    const stdout = captureCommand(
      process.execPath,
      [tsxCliPath, '--tsconfig', scriptsTsconfigPath, runnerPath, moduleUrl.href, exportName],
      repositoryRoot,
      process.env,
    );
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to read ${exportName} from ${moduleUrl.href}. ${TYPESCRIPT_SOURCE_RUNTIME_HINT}`, {
      cause: error,
    });
  }
}
