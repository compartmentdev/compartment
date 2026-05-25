import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readRepositoryRoot } from '../lib/repository-root.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const rootScriptRoots = ['scripts', '.codex/skills'];
const importSmokePaths = [
  'scripts/docs/public-docs/public-docs-areas.mjs',
  'scripts/docs/public-docs/public-docs-map.mjs',
  '.codex/skills/open-pr-and-monitor/scripts/public_docs_warning.mjs',
];

await main();

async function main() {
  const scriptPaths = await listScriptPaths();

  for (const scriptPath of scriptPaths) {
    execFileSync('node', ['--check', scriptPath], {
      cwd: repositoryRoot,
      stdio: 'inherit',
    });
  }

  for (const importSmokePath of importSmokePaths) {
    await import(pathToFileURL(resolve(repositoryRoot, importSmokePath)).href);
  }

  process.stdout.write(
    `Validated ${scriptPaths.length} script files and ${importSmokePaths.length} import smoke modules.\n`,
  );
}

async function listScriptPaths() {
  const scriptRoots = await listScriptRoots();
  const paths = [];

  for (const scriptRoot of scriptRoots) {
    paths.push(...(await listMjsFiles(resolve(repositoryRoot, scriptRoot))));
  }

  return paths.map((path) => relative(repositoryRoot, path)).sort((left, right) => left.localeCompare(right));
}

async function listScriptRoots() {
  const packageRoots = [];
  const packagesDirectory = resolve(repositoryRoot, 'packages');
  const packageEntries = await readdir(packagesDirectory, { withFileTypes: true });

  for (const packageEntry of packageEntries) {
    if (!packageEntry.isDirectory()) {
      continue;
    }

    const packageScriptsDirectory = join(packagesDirectory, packageEntry.name, 'scripts');

    try {
      await readdir(packageScriptsDirectory);
      packageRoots.push(relative(repositoryRoot, packageScriptsDirectory));
    } catch {
      continue;
    }
  }

  return [...rootScriptRoots, ...packageRoots];
}

async function listMjsFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listMjsFiles(path)));
      continue;
    }

    if (path.endsWith('.mjs')) {
      paths.push(path);
    }
  }

  return paths;
}
