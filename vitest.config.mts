import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnvFile } from 'dotenv';
import { configDefaults, coverageConfigDefaults, defineConfig } from 'vitest/config';

export const repoRoot: string = dirname(fileURLToPath(import.meta.url));
loadEnvFile({
  override: false,
  path: resolve(repoRoot, '.env.example'),
});
const packagesRoot: string = resolve(repoRoot, 'packages');
const defaultTestExcludes: string[] = [
  '**/*.db.test.ts',
  '**/*.integration.test.ts',
  '**/cli.smoke.test.ts',
  '**/*.e2e.test.ts',
];

const packageWorkspaceAliases = Object.fromEntries(
  readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [`@compartment/${entry.name}`, resolve(packagesRoot, entry.name, 'src', 'index.ts')]),
);
export const workspaceAliases = {
  '@compartment/contracts/browser': resolve(packagesRoot, 'contracts', 'src', 'index.browser.ts'),
  '@compartment/utils/metrics': resolve(packagesRoot, 'utils', 'src', 'prometheus-metrics.ts'),
  ...packageWorkspaceAliases,
};

export const unitTestExcludePatterns: string[] = [...configDefaults.exclude, '**/dist-test/**', ...defaultTestExcludes];
export const dbTestExcludePatterns: string[] = [...configDefaults.exclude, '**/dist-test/**'];
export const dbCoverageExcludePatterns: string[] = [...configDefaults.exclude, '**/dist-test/**', '**/*.e2e.test.ts'];
export const mockCleanupSettings = {
  clearMocks: true,
  restoreMocks: true,
} as const;
export const coverageSettings = {
  all: true,
  clean: true,
  provider: 'v8' as const,
  reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
  reportsDirectory: resolve(repoRoot, 'coverage'),
  include: ['packages/*/src/**/*.ts', 'packages/*/drizzle.config.ts'],
  exclude: [...coverageConfigDefaults.exclude],
};
export const nodeVitestConfigBase = {
  esbuild: {
    jsx: 'automatic' as const,
    jsxImportSource: 'react' as const,
  },
  root: process.cwd(),
  resolve: {
    alias: workspaceAliases,
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
};
export const nodeVitestTestBase = {
  environment: 'node',
  ...mockCleanupSettings,
  setupFiles: [resolve(repoRoot, 'vitest.setup.mts')],
  coverage: coverageSettings,
};

export default defineConfig({
  ...nodeVitestConfigBase,
  test: {
    ...nodeVitestTestBase,
    exclude: unitTestExcludePatterns,
  },
});
