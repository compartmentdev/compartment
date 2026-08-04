import { fileURLToPath } from 'node:url';

export const repoRootDir = fileURLToPath(new URL('../../', import.meta.url));

const allowedBoundaryImportsByPackage = {
  contracts: [],
  utils: [],
  api: ['console', 'contracts', 'sdk', 'source-archive', 'utils'],
  console: ['contracts', 'utils'],
  edge: ['contracts', 'sdk', 'utils'],
  docker: [],
  node: ['contracts', 'docker', 'sdk', 'utils'],
  cli: ['contracts', 'sdk', 'source-archive', 'utils'],
  sdk: ['contracts', 'utils'],
  'source-archive': ['contracts', 'utils'],
  worker: ['contracts', 'docker', 'sdk', 'source-archive', 'utils'],
  'test-support': ['docker', 'utils'],
};

export const runtimePackages = Object.keys(allowedBoundaryImportsByPackage);

export const boundaryElements = runtimePackages.map((packageName) => ({
  type: packageName,
  pattern: `packages/${packageName}/src/**/*`,
}));

function readRestrictedImports(packageName) {
  const allowedBoundaryImports = new Set(allowedBoundaryImportsByPackage[packageName] ?? []);
  const disallowedPackages = runtimePackages.filter(
    (candidatePackageName) => candidatePackageName !== packageName && !allowedBoundaryImports.has(candidatePackageName),
  );

  if (disallowedPackages.length === runtimePackages.length - 1) {
    return ['@compartment/*'];
  }

  return disallowedPackages.map((candidatePackageName) => `@compartment/${candidatePackageName}`);
}

export const restrictedByPackage = Object.fromEntries(
  runtimePackages.map((packageName) => [packageName, readRestrictedImports(packageName)]),
);

export const boundaryRules = runtimePackages.map((packageName) => ({
  from: packageName,
  allow: allowedBoundaryImportsByPackage[packageName] ?? [],
}));

export const crossPackagePrivateImportPatterns = [
  {
    regex: '^@compartment/[^/]+/src/',
    message:
      'Do not import private package internals through @compartment/*/src/. Import the public package entrypoint instead.',
  },
  {
    regex: '^(?:\\.\\./){2,}[^/]+/src/',
    message:
      'Do not import another package through a relative ../<package>/src/ path. Import its public package entrypoint instead.',
  },
  {
    regex: '^(?:\\.\\./)+packages/[^/]+/src/',
    message:
      'Do not import package internals through ../packages/*/src/. Import the public package entrypoint instead.',
  },
];

export const runtimeSingletonImportPatterns = [
  {
    group: ['**/runtime/runtime'],
    message: 'Only app.ts, server.ts, and runtime/* may import runtime/runtime.',
  },
];

const packageSourceFiles = [
  'packages/*/src/**/*.ts',
  'packages/*/src/**/*.tsx',
  'packages/*/src/**/*.mts',
  'packages/*/src/**/*.cts',
];

const packageTestFiles = [
  'packages/*/test/**/*.ts',
  'packages/*/test/**/*.tsx',
  'packages/*/test/**/*.mts',
  'packages/*/test/**/*.cts',
];

const packageScriptFiles = ['packages/*/scripts/**/*.ts', 'packages/*/scripts/**/*.mts'];
const packageConfigFiles = ['packages/*/*.ts', 'packages/*/*.tsx', 'packages/*/*.mts', 'packages/*/*.cts'];
const rootTypedFiles = ['*.mts'];
const skillScriptTypedFiles = ['.codex/skills/**/scripts/**/*.ts', '.codex/skills/**/scripts/**/*.mts'];
export const scriptTypedFiles = ['scripts/**/*.ts', 'scripts/**/*.mts', ...skillScriptTypedFiles];
export const publicDocsTypedFiles = ['public-docs/**/*.ts'];
const publicDocsModuleFiles = ['public-docs/**/*.mjs'];
export const publicDocsAstroFiles = ['public-docs/**/*.astro'];
const publicDocsImportFiles = [...publicDocsTypedFiles, ...publicDocsModuleFiles];
export const typedLintFiles = [
  ...packageSourceFiles,
  ...packageTestFiles,
  ...packageScriptFiles,
  ...packageConfigFiles,
  ...scriptTypedFiles,
  ...publicDocsTypedFiles,
  ...rootTypedFiles,
];
export const strictTypedFiles = [
  ...packageSourceFiles,
  ...packageScriptFiles,
  ...scriptTypedFiles,
  ...publicDocsTypedFiles,
];
const runtimeAndScriptImportFiles = [...packageSourceFiles, ...packageScriptFiles, ...scriptTypedFiles];
export const strictImportFiles = [...runtimeAndScriptImportFiles, ...publicDocsImportFiles];
export const exampleJavaScriptFiles = ['examples/**/*.js', 'examples/**/*.mjs', 'examples/**/*.cjs'];
export const exampleTypedFiles = ['examples/**/*.ts', 'examples/**/*.tsx', 'examples/**/*.mts', 'examples/**/*.cts'];
export const nodeScriptFiles = [
  '**/*.js',
  '**/*.mjs',
  '**/*.cjs',
  '.husky/**/*.mjs',
  '.husky/**/*.js',
  '.husky/**/*.cjs',
  '.codex/skills/**/scripts/**/*.js',
  '.codex/skills/**/scripts/**/*.mjs',
  '.codex/skills/**/scripts/**/*.cjs',
  'scripts/**/*.mjs',
  'packages/*/scripts/**/*.mjs',
];
export const typedDefaultProjectFiles = ['*.mts'];
export const unassignedImportAllowPatterns = ['**/*.css', '**/http/request.types'];
export const testFiles = packageTestFiles;
export const extendedTestFiles = [
  '**/test/**/*.integration.test.ts',
  '**/test/**/*.integration.test.tsx',
  '**/test/**/*.integration.test.mts',
  '**/test/**/*.db.test.ts',
  '**/test/**/*.db.test.tsx',
  '**/test/**/*.db.test.mts',
  '**/test/**/*.smoke.test.ts',
  '**/test/**/*.smoke.test.tsx',
  '**/test/**/*.smoke.test.mts',
  '**/test/**/*.e2e.test.ts',
  '**/test/**/*.e2e.test.tsx',
  '**/test/**/*.e2e.test.mts',
];

export const nodeScriptGlobals = {
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  process: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
};

export function scopeConfigs(configs, files) {
  return configs.map((config) => ({
    ...config,
    files,
  }));
}
