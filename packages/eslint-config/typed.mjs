import boundaries from 'eslint-plugin-boundaries';
import importPlugin from 'eslint-plugin-import';
import sonarjs from 'eslint-plugin-sonarjs';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from 'typescript-eslint';
import compartmentPlugin from '@compartment/eslint-plugin';
import {
  boundaryElements,
  boundaryRules,
  publicDocsTypedFiles,
  repoRootDir,
  runtimePackages,
  strictImportFiles,
  strictTypedFiles,
  typedDefaultProjectFiles,
  typedLintFiles,
  unassignedImportAllowPatterns,
  scopeConfigs,
} from './shared.mjs';

const sonarjsRecommendedRules = sonarjs.configs.recommended.rules;
const packageTestProjectOverrides = runtimePackages.map((packageName) => ({
  files: [
    `packages/${packageName}/test/**/*.ts`,
    `packages/${packageName}/test/**/*.tsx`,
    `packages/${packageName}/test/**/*.mts`,
    `packages/${packageName}/test/**/*.cts`,
  ],
  languageOptions: {
    parserOptions: {
      project: `./packages/${packageName}/tsconfig.test.json`,
      projectService: false,
      tsconfigRootDir: repoRootDir,
    },
  },
}));

export default [
  ...scopeConfigs(tseslint.configs.recommendedTypeChecked, typedLintFiles),
  ...scopeConfigs(tseslint.configs.stylisticTypeChecked, typedLintFiles),
  {
    files: typedLintFiles,
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: typedDefaultProjectFiles,
          defaultProject: './scripts/tsconfig.json',
        },
        tsconfigRootDir: repoRootDir,
      },
    },
    plugins: {
      boundaries,
      import: importPlugin,
      sonarjs,
      compartment: compartmentPlugin,
      'unused-imports': unusedImports,
    },
    settings: {
      'boundaries/elements': boundaryElements,
    },
    rules: {
      ...sonarjsRecommendedRules,
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            unknown: {
              message: 'Use a concrete type or a named validated boundary type instead of unknown.',
            },
          },
        },
      ],
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-template-expression': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-as-const': 'off',
      '@typescript-eslint/prefer-function-type': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/return-await': ['error', 'always'],
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowNumber: false,
          allowString: false,
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
        },
      ],
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: boundaryRules,
        },
      ],
      'compartment/no-anonymous-interface-implementation': 'error',
      'compartment/no-inline-multiline-text-join': 'error',
      'compartment/no-reflection-type-syntax': 'error',
      'compartment/no-trivial-pass-through-wrapper': 'error',
      'compartment/package-file-placement-convention': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'import/first': 'error',
      'no-console': [
        'error',
        {
          allow: ['warn', 'error'],
        },
      ],
      'no-duplicate-imports': 'error',
      'no-nested-ternary': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'TSTypeReference[typeName.type="TSQualifiedName"][typeName.left.name="z"][typeName.right.name="infer"]',
          message: 'Do not use z.infer. Declare named types or interfaces explicitly.',
        },
        {
          selector: ':matches(ObjectExpression, ArrayExpression) > SpreadElement[argument.type="AwaitExpression"]',
          message: 'Do not inline await inside spread expressions. Await into a named local first.',
        },
      ],
      'no-var': 'error',
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
      ],
      'prefer-const': 'error',
      'sonarjs/concise-regex': 'off',
      'sonarjs/deprecation': 'off',
      'sonarjs/no-nested-conditional': 'off',
      'sonarjs/no-nested-template-literals': 'off',
      'sonarjs/no-os-command-from-path': 'off',
      'sonarjs/no-unused-vars': 'off',
      'sonarjs/regex-complexity': 'off',
      'sonarjs/slow-regex': 'off',
      'sonarjs/unused-import': 'off',
      'sonarjs/use-type-alias': 'off',
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
  {
    files: ['packages/console/src/**/*.ts', 'packages/console/src/**/*.tsx'],
    ignores: ['packages/console/src/index.ts'],
    languageOptions: {
      parserOptions: {
        project: './packages/console/tsconfig.browser.json',
        projectService: false,
        tsconfigRootDir: repoRootDir,
      },
    },
  },
  {
    files: ['packages/console/vite.config.ts'],
    languageOptions: {
      parserOptions: {
        project: './packages/console/tsconfig.browser.json',
        projectService: false,
        tsconfigRootDir: repoRootDir,
      },
    },
  },
  {
    files: ['packages/api/vitest.package.config.mts'],
    languageOptions: {
      parserOptions: {
        project: './packages/api/tsconfig.vitest.json',
        projectService: false,
        tsconfigRootDir: repoRootDir,
      },
    },
  },
  ...packageTestProjectOverrides,
  {
    files: strictImportFiles,
    rules: {
      'import/no-unassigned-import': [
        'error',
        {
          allow: unassignedImportAllowPatterns,
        },
      ],
    },
  },
  {
    files: strictTypedFiles,
    rules: {
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-unnecessary-template-expression': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        {
          ignoreConditionalTests: true,
          ignoreMixedLogicalExpressions: true,
        },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allow: [{ from: 'lib', name: ['Error', 'URL', 'URLSearchParams'] }],
          allowAny: false,
          allowBoolean: true,
          allowNullish: true,
          allowNumber: true,
          allowRegExp: true,
        },
      ],
    },
  },
  {
    files: publicDocsTypedFiles,
    rules: {
      'boundaries/element-types': 'off',
      'compartment/package-file-placement-convention': 'off',
    },
  },
];
