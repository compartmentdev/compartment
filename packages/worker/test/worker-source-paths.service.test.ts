import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompartmentSourcePackageMetadata } from '@compartment/contracts';
import { prepareSourcePaths } from '../src/services/worker-source-paths.service';

const tempDirectories: string[] = [];

afterEach(async (): Promise<void> => {
  await Promise.all(
    tempDirectories.map(async (directory: string): Promise<void> => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
  tempDirectories.length = 0;
});

describe('prepareSourcePaths', (): void => {
  it('rejects symlinked build.include paths in the extracted source archive', async (): Promise<void> => {
    const extractionDirectory: string = await createTrackedTempDirectory('compartment-worker-source-paths-');
    const outsideDirectory: string = await createTrackedTempDirectory('compartment-worker-source-paths-outside-');

    await mkdir(join(extractionDirectory, 'apps', 'web'), { recursive: true });
    await mkdir(join(outsideDirectory, 'shared'), { recursive: true });
    await writeFile(join(extractionDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await symlink(join(outsideDirectory, 'shared'), join(extractionDirectory, 'packages-link'));

    await expect(
      prepareSourcePaths(
        {
          extractionDirectory,
          includePaths: ['../../packages-link'],
          servicePath: '.',
        },
        createDescriptorRelativeMetadata(),
      ),
    ).rejects.toThrow('build.include path "../../packages-link" must not include symlinks.');
  });

  it('rejects symlink entries inside the inferred build context after extraction', async (): Promise<void> => {
    const extractionDirectory: string = await createTrackedTempDirectory('compartment-worker-source-paths-');
    const outsideDirectory: string = await createTrackedTempDirectory('compartment-worker-source-paths-outside-');

    await mkdir(join(extractionDirectory, 'apps', 'web'), { recursive: true });
    await mkdir(join(outsideDirectory, 'shared'), { recursive: true });
    await writeFile(join(extractionDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await symlink(join(outsideDirectory, 'shared'), join(extractionDirectory, 'apps', 'web', 'escape-link'));

    await expect(
      prepareSourcePaths(
        {
          extractionDirectory,
          includePaths: [],
          servicePath: '.',
        },
        createDescriptorRelativeMetadata(),
      ),
    ).rejects.toThrow('must not include symlink entry "apps/web/escape-link"');
  });
});

function createDescriptorRelativeMetadata(): CompartmentSourcePackageMetadata {
  return {
    descriptorDirectoryRelativePath: 'apps/web',
    version: 1,
  };
}

async function createTrackedTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.push(directory);

  return directory;
}
