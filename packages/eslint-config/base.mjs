import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';
import compartmentPlugin from '@compartment/eslint-plugin';
import { nodeScriptFiles, nodeScriptGlobals, testFiles, scopeConfigs } from './shared.mjs';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/browser-dist/**',
      '**/dist-test/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/.astro/**',
      '**/.generated/**',
      'public-docs/src/content/docs/reference/generated/**',
    ],
  },
  js.configs.recommended,
  prettier,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      globals: nodeScriptGlobals,
    },
    plugins: {
      compartment: compartmentPlugin,
      import: importPlugin,
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'compartment/no-inline-multiline-text-join': 'error',
      'import/first': 'error',
      'no-console': [
        'error',
        {
          allow: ['warn', 'error'],
        },
      ],
      'no-duplicate-imports': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: nodeScriptFiles,
    languageOptions: {
      globals: nodeScriptGlobals,
    },
  },
  ...scopeConfigs(tseslint.configs.recommended, testFiles),
];
