import eslintPluginAstro from 'eslint-plugin-astro';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

const duplicateRules = {
  'sonarjs/no-all-duplicated-branches': 'error',
  'sonarjs/no-duplicated-branches': 'error',
  'sonarjs/no-identical-conditions': 'error',
  'sonarjs/no-identical-expressions': 'error',
  'sonarjs/no-identical-functions': 'error',
};

export const duplicatesConfig = [
  {
    ignores: [
      '**/dist/**',
      '**/browser-dist/**',
      '**/dist-test/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.astro/**',
      '**/.turbo/**',
      '**/drizzle/**',
      '**/*.d.ts',
      'packages/api/vitest.package.config.mts',
      'public-docs/src/assets/**',
      'public-docs/src/content/docs/reference/generated/**',
      'examples/**',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  ...eslintPluginAstro.configs['flat/base'],
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      sonarjs,
    },
    rules: duplicateRules,
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      sonarjs,
    },
    rules: duplicateRules,
  },
  {
    files: ['public-docs/**/*.astro'],
    plugins: {
      sonarjs,
    },
    rules: duplicateRules,
  },
];
