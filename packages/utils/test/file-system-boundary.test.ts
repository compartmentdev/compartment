import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ValidatedFileSystemWriteTarget,
  validateSymlinkFreeFileSystemDirectory,
  validateSymlinkFreeFileSystemEntry,
  validateSymlinkFreeFileSystemWriteTarget,
} from '../src/file-system-boundary';

const tempDirectories: string[] = [];

afterEach(async (): Promise<void> => {
  await Promise.all(
    tempDirectories.map(async (directory: string): Promise<void> => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
  tempDirectories.length = 0;
});

describe('file system boundary validation', (): void => {
  it('accepts a normal in-boundary directory selection', async (): Promise<void> => {
    const rootDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-');
    await mkdir(join(rootDirectory, 'apps', 'web'), { recursive: true });
    await writeFile(join(rootDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');

    await expect(
      validateSymlinkFreeFileSystemDirectory({
        absolutePath: resolve(rootDirectory, 'apps/web'),
        authoredPath: 'apps/web',
        boundaryDirectory: rootDirectory,
        boundaryLabel: 'the uploaded source archive',
        label: 'Service path',
        relativeToLabel: 'the uploaded source archive root',
      }),
    ).resolves.toMatchObject({
      absolutePath: resolve(rootDirectory, 'apps/web'),
    });
  });

  it('rejects absolute authored paths', async (): Promise<void> => {
    const rootDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-');
    await mkdir(join(rootDirectory, 'apps', 'web'), { recursive: true });

    await expect(
      validateSymlinkFreeFileSystemDirectory({
        absolutePath: resolve(rootDirectory, 'apps/web'),
        authoredPath: '/tmp/escape',
        boundaryDirectory: rootDirectory,
        boundaryLabel: 'the uploaded source archive',
        label: 'Service path',
        relativeToLabel: 'the uploaded source archive root',
      }),
    ).rejects.toThrow('must be relative to the uploaded source archive root');
  });

  it('rejects paths that escape the boundary with dotdot traversal', async (): Promise<void> => {
    const rootDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-');
    const outsideDirectory: string = `${rootDirectory}-outside`;

    await mkdir(join(outsideDirectory, 'apps', 'web'), { recursive: true });
    tempDirectories.push(outsideDirectory);

    await expect(
      validateSymlinkFreeFileSystemDirectory({
        absolutePath: resolve(rootDirectory, '../', `${rootDirectory.split('/').at(-1)}-outside`, 'apps/web'),
        authoredPath: '../outside/apps/web',
        boundaryDirectory: rootDirectory,
        boundaryLabel: 'the uploaded source archive',
        label: 'Service path',
        relativeToLabel: 'the uploaded source archive root',
      }),
    ).rejects.toThrow('must stay within the uploaded source archive');
  });

  it('rejects symlinked targets that resolve outside the boundary', async (): Promise<void> => {
    const rootDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-');
    const outsideDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-outside-');

    await mkdir(join(rootDirectory, 'apps'), { recursive: true });
    await mkdir(join(outsideDirectory, 'shared'), { recursive: true });
    await symlink(join(outsideDirectory, 'shared'), join(rootDirectory, 'apps', 'shared-link'));

    await expect(
      validateSymlinkFreeFileSystemDirectory({
        absolutePath: resolve(rootDirectory, 'apps/shared-link'),
        authoredPath: 'apps/shared-link',
        boundaryDirectory: rootDirectory,
        boundaryLabel: 'the uploaded source archive',
        label: 'Service path',
        relativeToLabel: 'the uploaded source archive root',
      }),
    ).rejects.toThrow('must not include symlinks');
  });

  it('rejects symlink entries inside a selected directory tree', async (): Promise<void> => {
    const rootDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-');
    const outsideDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-outside-');

    await mkdir(join(rootDirectory, 'apps', 'web'), { recursive: true });
    await mkdir(join(outsideDirectory, 'shared'), { recursive: true });
    await writeFile(join(rootDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await symlink(join(outsideDirectory, 'shared'), join(rootDirectory, 'apps', 'web', 'escape-link'));

    await expect(
      validateSymlinkFreeFileSystemDirectory({
        absolutePath: resolve(rootDirectory, 'apps/web'),
        authoredPath: 'apps/web',
        boundaryDirectory: rootDirectory,
        boundaryLabel: 'the uploaded source archive',
        label: 'Build context for service "apps/web"',
        relativeToLabel: 'the uploaded source archive root',
      }),
    ).rejects.toThrow('must not include symlink entry "apps/web/escape-link"');
  });

  it('accepts a regular file selection when files are allowed', async (): Promise<void> => {
    const rootDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-');
    await mkdir(join(rootDirectory, 'packages'), { recursive: true });
    await writeFile(join(rootDirectory, 'packages', 'shared.ts'), 'export const shared = true;\n');

    await expect(
      validateSymlinkFreeFileSystemEntry({
        absolutePath: resolve(rootDirectory, 'packages/shared.ts'),
        authoredPath: 'packages/shared.ts',
        boundaryDirectory: rootDirectory,
        boundaryLabel: 'the uploaded source archive',
        expectedKind: 'any',
        label: 'build.include path',
        relativeToLabel: 'the uploaded source archive',
      }),
    ).resolves.toMatchObject({
      absolutePath: resolve(rootDirectory, 'packages/shared.ts'),
    });
  });

  it('reports whether an in-boundary write target exists', async (): Promise<void> => {
    const rootDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-');
    await mkdir(join(rootDirectory, 'config'), { recursive: true });

    await expect(validateRepositoryConfigWriteTarget(rootDirectory, 'config/missing.json')).resolves.toMatchObject({
      absolutePath: resolve(rootDirectory, 'config/missing.json'),
      exists: false,
    });

    await writeFile(join(rootDirectory, 'config/settings.json'), '{}\n', 'utf8');
    await expect(validateRepositoryConfigWriteTarget(rootDirectory, 'config/settings.json')).resolves.toMatchObject({
      absolutePath: resolve(rootDirectory, 'config/settings.json'),
      exists: true,
    });
  });

  it('accepts directory write targets when requested', async (): Promise<void> => {
    const rootDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-');
    await mkdir(join(rootDirectory, 'backups'), { recursive: true });

    await expect(
      validateSymlinkFreeFileSystemWriteTarget({
        absolutePath: resolve(rootDirectory, 'backups/new'),
        authoredPath: 'backups/new',
        boundaryDirectory: rootDirectory,
        boundaryLabel: 'runtime storage',
        expectedKind: 'directory',
        label: 'Backup directory',
        relativeToLabel: 'runtime storage root',
      }),
    ).resolves.toMatchObject({
      exists: false,
    });

    await mkdir(join(rootDirectory, 'backups/existing'));
    await expect(
      validateSymlinkFreeFileSystemWriteTarget({
        absolutePath: resolve(rootDirectory, 'backups/existing'),
        authoredPath: 'backups/existing',
        boundaryDirectory: rootDirectory,
        boundaryLabel: 'runtime storage',
        expectedKind: 'directory',
        label: 'Backup directory',
        relativeToLabel: 'runtime storage root',
      }),
    ).resolves.toMatchObject({
      exists: true,
    });
  });

  it('rejects write targets with the wrong expected kind', async (): Promise<void> => {
    const rootDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-');
    await mkdir(join(rootDirectory, 'backups'), { recursive: true });
    await writeFile(join(rootDirectory, 'backups', 'archive.tgz'), 'archive');

    await expect(
      validateSymlinkFreeFileSystemWriteTarget({
        absolutePath: resolve(rootDirectory, 'backups'),
        authoredPath: 'backups',
        boundaryDirectory: rootDirectory,
        boundaryLabel: 'runtime storage',
        label: 'Backup file',
        relativeToLabel: 'runtime storage root',
      }),
    ).rejects.toThrow('must point to a file');

    await expect(
      validateSymlinkFreeFileSystemWriteTarget({
        absolutePath: resolve(rootDirectory, 'backups/archive.tgz'),
        authoredPath: 'backups/archive.tgz',
        boundaryDirectory: rootDirectory,
        boundaryLabel: 'runtime storage',
        expectedKind: 'directory',
        label: 'Backup directory',
        relativeToLabel: 'runtime storage root',
      }),
    ).rejects.toThrow('must point to a directory');
  });

  it('rejects write targets that include symlinks', async (): Promise<void> => {
    const rootDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-');
    const outsideDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-outside-');

    await mkdir(join(rootDirectory, 'config'), { recursive: true });
    await writeFile(join(outsideDirectory, 'settings.json'), '{}\n', 'utf8');
    await symlink(join(outsideDirectory, 'settings.json'), join(rootDirectory, 'config/settings.json'));

    await expect(validateRepositoryConfigWriteTarget(rootDirectory, 'config/settings.json')).rejects.toThrow(
      'must not include symlinks',
    );

    const parentLinkRootDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-');
    const parentLinkOutsideDirectory: string = await createTrackedTempDirectory('compartment-utils-boundary-outside-');

    await mkdir(join(parentLinkOutsideDirectory, 'config'), { recursive: true });
    await symlink(join(parentLinkOutsideDirectory, 'config'), join(parentLinkRootDirectory, 'config'));

    await expect(validateRepositoryConfigWriteTarget(parentLinkRootDirectory, 'config/settings.json')).rejects.toThrow(
      'must not include symlinks',
    );
  });
});

async function validateRepositoryConfigWriteTarget(
  rootDirectory: string,
  authoredPath: string,
): Promise<ValidatedFileSystemWriteTarget> {
  return await validateSymlinkFreeFileSystemWriteTarget({
    absolutePath: resolve(rootDirectory, authoredPath),
    authoredPath,
    boundaryDirectory: rootDirectory,
    boundaryLabel: 'the Git repository',
    label: 'Config file',
    relativeToLabel: 'the Git repository root',
  });
}

async function createTrackedTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.push(directory);

  return directory;
}
