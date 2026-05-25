import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { readWorkspacePackageJsonPaths } from './release-version-files.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

describe('release-please config', () => {
  it('bumps every workspace package version and the self-hosted version template', async () => {
    const config = JSON.parse(await readFile(resolve(repositoryRoot, 'release-please-config.json'), 'utf8'));
    const packageConfig = config.packages['.'];
    const extraFilePaths = packageConfig['extra-files'].map((extraFile) => extraFile.path).sort();
    const packageJsonPaths = (await readWorkspacePackageJsonPaths(repositoryRoot))
      .map((path) => relative(repositoryRoot, path))
      .sort();

    expect(extraFilePaths.filter((path) => path.endsWith('/package.json'))).toEqual(packageJsonPaths);
    expect(extraFilePaths).toContain('.env.self-hosted.example');
  });
});
