import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import {
  coverageSettings,
  dbTestExcludePatterns,
  mockCleanupSettings,
  repoRoot,
  workspaceAliases,
} from './vitest.config.mts';

const dbTestIncludePatterns: string[] = [
  'packages/**/*.db.test.ts',
  'packages/**/*.integration.test.ts',
  'packages/cli/test/cli.smoke.test.ts',
];

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
    globalSetup: [resolve(repoRoot, 'packages/test-support/test/database-run.global-setup.ts')],
    include: dbTestIncludePatterns,
    fileParallelism: true,
    maxWorkers: 4,
    minWorkers: 1,
    ...mockCleanupSettings,
    setupFiles: [resolve(repoRoot, 'vitest.setup.mts')],
    coverage: coverageSettings,
  },
});
