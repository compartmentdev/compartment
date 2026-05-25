import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from 'typescript-eslint';
import compartmentPlugin from '@compartment/eslint-plugin';
import { exampleJavaScriptFiles, exampleTypedFiles, nodeScriptGlobals, scopeConfigs } from './shared.mjs';

export default [
  ...scopeConfigs(tseslint.configs.recommended, exampleTypedFiles),
  {
    files: [...exampleJavaScriptFiles, ...exampleTypedFiles],
    languageOptions: {
      globals: nodeScriptGlobals,
    },
  },
  {
    files: exampleJavaScriptFiles,
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: exampleTypedFiles,
    plugins: {
      compartment: compartmentPlugin,
      import: importPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      'compartment/no-inline-multiline-text-join': 'error',
      'import/first': 'error',
      'no-console': 'off',
      'no-duplicate-imports': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
];
