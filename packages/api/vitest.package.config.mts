import { configDefaults, defineConfig } from 'vitest/config';
import { nodeVitestConfigBase, nodeVitestTestBase } from '../../vitest.config.mts';

const packageUnitExcludePatterns: string[] = [
  ...configDefaults.exclude,
  'dist-test/**',
  'test/**/*.db.test.ts',
  'test/**/*.integration.test.ts',
];

export default defineConfig({
  ...nodeVitestConfigBase,
  test: {
    ...nodeVitestTestBase,
    exclude: packageUnitExcludePatterns,
  },
});
