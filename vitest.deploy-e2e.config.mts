import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import {
  coverageSettings,
  dbTestExcludePatterns,
  mockCleanupSettings,
  repoRoot,
  workspaceAliases,
} from './vitest.config.mts';

const deployE2eIncludeEnvName: string = 'COMPARTMENT_DEPLOY_E2E_INCLUDE';
const defaultDeployE2eIncludePattern: string = 'test/*.e2e.test.ts';

function readDeployE2eIncludePatterns(env: NodeJS.ProcessEnv = process.env): string[] {
  const configuredValue: string | undefined = env[deployE2eIncludeEnvName];
  const includePattern: string = configuredValue?.trim() ?? '';
  if (includePattern === '') {
    return [defaultDeployE2eIncludePattern];
  }

  return [includePattern];
}

const deployE2eIncludePatterns: string[] = readDeployE2eIncludePatterns();

export default defineConfig({
  root: process.cwd(),
  resolve: {
    alias: workspaceAliases,
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  test: {
    environment: 'node',
    exclude: dbTestExcludePatterns,
    include: deployE2eIncludePatterns,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    ...mockCleanupSettings,
    setupFiles: [resolve(repoRoot, 'vitest.setup.mts')],
    coverage: coverageSettings,
  },
});
