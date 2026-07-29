import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanPackageBuildOutputs } from './clean-package-build-outputs.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('package build output cleanup', () => {
  it('removes only generated package output directories', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'compartment-build-clean-'));
    temporaryDirectories.push(repositoryRoot);
    const packageRoot = join(repositoryRoot, 'packages', 'cli');
    await mkdir(join(packageRoot, 'dist'), { recursive: true });
    await mkdir(join(packageRoot, 'browser-dist'), { recursive: true });
    await mkdir(join(packageRoot, 'src'), { recursive: true });
    await writeFile(join(packageRoot, 'dist', 'stale.js'), 'stale');
    await writeFile(join(packageRoot, 'browser-dist', 'stale.js'), 'stale');
    await writeFile(join(packageRoot, 'src', 'index.ts'), 'export {};');

    cleanPackageBuildOutputs(repositoryRoot);

    expect(existsSync(join(packageRoot, 'dist'))).toBe(false);
    expect(existsSync(join(packageRoot, 'browser-dist'))).toBe(false);
    expect(existsSync(join(packageRoot, 'src', 'index.ts'))).toBe(true);
  });
});
