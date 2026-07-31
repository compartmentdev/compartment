import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import {
  coverageSettings,
  dbCoverageExcludePatterns,
  mockCleanupSettings,
  repoRoot,
  workspaceAliases,
} from './vitest.config.mts';

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
    exclude: dbCoverageExcludePatterns,
    fileParallelism: false,
    globalSetup: [resolve(repoRoot, 'packages/test-support/test/database-run.global-setup.ts')],
    maxWorkers: 1,
    minWorkers: 1,
    ...mockCleanupSettings,
    setupFiles: [resolve(repoRoot, 'vitest.setup.mts')],
    coverage: coverageSettings,
  },
});
