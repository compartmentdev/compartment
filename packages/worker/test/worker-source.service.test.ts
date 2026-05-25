import { execFile } from 'node:child_process';
import type { BigIntStats, Stats } from 'node:fs';
import type * as FsPromisesModule from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  joinCompartmentSourcePackageRelativePath,
  serializeCompartmentSourcePackageMetadata,
  type CompartmentSourcePackageMetadata,
  type ResolvedCompartmentServiceBuildConfig,
} from '@compartment/contracts';
import { prepareServiceDirectory as prepareServiceDirectoryInternal } from '../src/services/worker-source.service';
import type { PreparedWorkerSource, WorkerSourceServiceInput } from '../src/services/worker-source.service.types';

type ServiceBuildStrategy = 'auto' | 'dockerfile' | 'railpack';
interface ServiceBuildPackages {
  build: string[];
  runtime: string[];
}

type StatPath = string | URL | Buffer;
interface StatFileBaseOptions {
  throwIfNoEntry?: boolean | undefined;
}
interface StatFileStatsOptions extends StatFileBaseOptions {
  bigint?: false | undefined;
}
interface StatFileBigIntOptions extends StatFileBaseOptions {
  bigint: true;
}
type StatFileOptions = StatFileStatsOptions | StatFileBigIntOptions;
type MockStatFile = (path: StatPath, options?: StatFileOptions) => Promise<Stats | BigIntStats>;
interface StatFile {
  (path: StatPath, options?: StatFileStatsOptions): Promise<Stats>;
  (path: StatPath, options: StatFileBigIntOptions): Promise<BigIntStats>;
  (path: StatPath, options?: StatFileOptions): Promise<Stats | BigIntStats>;
}
type ImportOriginalFsPromises = () => Promise<typeof FsPromisesModule>;

interface WorkerSourceTestMocks {
  stat: Mock<MockStatFile>;
}

const mocks: WorkerSourceTestMocks = vi.hoisted(
  (): WorkerSourceTestMocks => ({
    stat: vi.fn<MockStatFile>(),
  }),
);

vi.mock('node:fs/promises', async (importOriginal: ImportOriginalFsPromises): Promise<typeof FsPromisesModule> => {
  const actual: typeof FsPromisesModule = await importOriginal();
  async function statMock(path: StatPath, options?: StatFileStatsOptions): Promise<Stats>;
  async function statMock(path: StatPath, options: StatFileBigIntOptions): Promise<BigIntStats>;
  async function statMock(path: StatPath, options?: StatFileOptions): Promise<Stats | BigIntStats> {
    const mockImplementation: MockStatFile | undefined = mocks.stat.getMockImplementation();
    if (mockImplementation !== undefined) {
      return await mockImplementation(path, options);
    }

    return await actual.stat(path, options);
  }

  return {
    ...actual,
    stat: statMock as StatFile,
  };
});

const executeFileAsync: (file: string, args: readonly string[]) => Promise<{ stderr: string; stdout: string }> =
  promisify(execFile);

const tempDirectories: string[] = [];

afterEach(async (): Promise<void> => {
  mocks.stat.mockReset();
  await Promise.all(
    tempDirectories.map(async (directory: string): Promise<void> => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
  tempDirectories.length = 0;
});

async function prepareServiceDirectory(
  tempDirectory: string,
  sourceArchive: Buffer,
  service: WorkerSourceServiceInput,
  build: ResolvedCompartmentServiceBuildConfig,
  requireRoutesFile: boolean = false,
): Promise<PreparedWorkerSource> {
  return await prepareServiceDirectoryInternal(tempDirectory, sourceArchive, service, build, requireRoutesFile);
}

describe('prepareServiceDirectory', (): void => {
  it('selects the dockerfile packer when the service contains a Dockerfile', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/Dockerfile': 'FROM node:24-alpine\n',
        'apps/web/package.json': '{"name":"web"}\n',
      },
      createRootSourcePackageMetadata(),
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', 'apps/web'),
        createResolvedBuildConfig(),
      ),
    ).resolves.toMatchObject({
      buildContextDirectory: join(tempDirectory, 'src', 'apps', 'web'),
      dockerfilePath: 'Dockerfile',
      packer: 'dockerfile',
      serviceRelativePath: '.',
    });
  });

  it('falls back to the railpack packer when the service does not contain a Dockerfile', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
        'apps/web/server.js': 'console.log("ready");\n',
      },
      createRootSourcePackageMetadata(),
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', 'apps/web'),
        createResolvedBuildConfig(),
      ),
    ).resolves.toMatchObject({
      buildContextDirectory: join(tempDirectory, 'src', 'apps', 'web'),
      packer: 'railpack',
      serviceRelativePath: '.',
    });
  });

  it('forces static services onto the static packer even when the service contains a Dockerfile', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/site/Dockerfile': 'FROM node:24-alpine\n',
        'apps/site/package.json': '{"name":"site"}\n',
      },
      createRootSourcePackageMetadata(),
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        {
          kind: 'static',
          name: 'site',
          path: 'apps/site',
        },
        {
          env: [],
          include: [],
          outputDirectory: 'dist',
          packages: {
            build: [],
            runtime: [],
          },
          strategy: 'auto',
        },
      ),
    ).resolves.toMatchObject({
      buildContextDirectory: join(tempDirectory, 'src', 'apps', 'site'),
      outputDirectory: 'dist',
      packer: 'static',
      serviceRelativePath: '.',
    });
  });

  it('widens the build context only when build.include escapes the service directory', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/Dockerfile': 'FROM node:24-alpine\n',
        'apps/web/package.json': '{"name":"web"}\n',
        'packages/shared/message.mjs': 'export const message = "shared";\n',
      },
      {
        descriptorDirectoryRelativePath: 'apps/web',
        version: 1,
      },
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', '.'),
        createResolvedBuildConfig('auto', undefined, { build: [], runtime: [] }, ['../../packages/shared']),
      ),
    ).resolves.toMatchObject({
      buildContextDirectory: join(tempDirectory, 'src'),
      dockerfilePath: 'apps/web/Dockerfile',
      packer: 'dockerfile',
      serviceRelativePath: 'apps/web',
    });
  });

  it('fails early for widened Railpack Node builds when only the service directory has package.json', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
        'packages/shared/message.mjs': 'export const message = "shared";\n',
      },
      {
        descriptorDirectoryRelativePath: 'apps/web',
        version: 1,
      },
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', '.'),
        createResolvedBuildConfig('railpack', undefined, { build: [], runtime: [] }, ['../../packages/shared']),
      ),
    ).rejects.toThrow(
      'Source builds for service "web" (path ".") install from the widened context root, not the service directory. The widened build context is missing "package.json" while the service directory contains one. Add the root workspace/package-manager files the widened build expects, or avoid widening build.include/refactor the project layout.',
    );
  });

  it('fails early for widened auto Railpack Node builds when only the service directory has package.json', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
        'packages/shared/message.mjs': 'export const message = "shared";\n',
      },
      {
        descriptorDirectoryRelativePath: 'apps/web',
        version: 1,
      },
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', '.'),
        createResolvedBuildConfig('auto', undefined, { build: [], runtime: [] }, ['../../packages/shared']),
      ),
    ).rejects.toThrow(
      'Source builds for service "web" (path ".") install from the widened context root, not the service directory. The widened build context is missing "package.json" while the service directory contains one. Add the root workspace/package-manager files the widened build expects, or avoid widening build.include/refactor the project layout.',
    );
  });

  it('keeps widened Railpack Node builds when the widened root also has package.json', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
        'package.json': '{"name":"root"}\n',
        'packages/shared/message.mjs': 'export const message = "shared";\n',
      },
      {
        descriptorDirectoryRelativePath: 'apps/web',
        version: 1,
      },
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', '.'),
        createResolvedBuildConfig('railpack', undefined, { build: [], runtime: [] }, ['../../packages/shared']),
      ),
    ).resolves.toMatchObject({
      buildContextDirectory: join(tempDirectory, 'src'),
      packer: 'railpack',
      serviceRelativePath: 'apps/web',
    });
  });

  it('prepares widened Railpack workspace builds from the context root', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'package.json': '{"name":"root","packageManager":"pnpm@10.6.3"}\n',
        'packages/api/package.json': '{"name":"api"}\n',
        'packages/shared/message.mjs': 'export const message = "shared";\n',
        'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n',
        'pnpm-workspace.yaml': 'packages:\\n  - packages/*\\n',
      },
      createRootSourcePackageMetadata(),
    );

    const preparedSource: PreparedWorkerSource = await prepareServiceDirectory(
      tempDirectory,
      sourceArchive,
      {
        kind: 'api',
        name: 'api',
        path: 'packages/api',
      },
      createResolvedBuildConfig('railpack', 'pnpm --filter api build', { build: [], runtime: [] }, [
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'packages/shared',
      ]),
    );

    expect(preparedSource).toMatchObject({
      buildCommand: 'pnpm --filter api build',
      buildContextDirectory: join(tempDirectory, 'src'),
      packer: 'railpack',
      serviceRelativePath: 'packages/api',
    });
    expect(preparedSource.sourceBuildInput).toEqual({});
  });

  it('keeps widened auto Railpack Node builds when the widened root also has package.json', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
        'package.json': '{"name":"root"}\n',
        'packages/shared/message.mjs': 'export const message = "shared";\n',
      },
      {
        descriptorDirectoryRelativePath: 'apps/web',
        version: 1,
      },
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', '.'),
        createResolvedBuildConfig('auto', undefined, { build: [], runtime: [] }, ['../../packages/shared']),
      ),
    ).resolves.toMatchObject({
      buildContextDirectory: join(tempDirectory, 'src'),
      packer: 'railpack',
      serviceRelativePath: 'apps/web',
    });
  });

  it('keeps widened non-Node Railpack builds when the service directory has no package.json', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/server.py': 'print("ready")\n',
        'packages/shared/message.py': 'MESSAGE = "shared"\n',
      },
      {
        descriptorDirectoryRelativePath: 'apps/web',
        version: 1,
      },
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', '.'),
        createResolvedBuildConfig('railpack', undefined, { build: [], runtime: [] }, ['../../packages/shared']),
      ),
    ).resolves.toMatchObject({
      buildContextDirectory: join(tempDirectory, 'src'),
      packer: 'railpack',
      serviceRelativePath: 'apps/web',
    });
  });

  it('prepares widened static workspace builds with a context-root source build plan', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'package.json': '{"name":"root"}\n',
        'public-docs/package.json': '{"name":"public-docs"}\n',
      },
      {
        descriptorDirectoryRelativePath: 'public-docs',
        version: 1,
      },
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        {
          kind: 'static',
          name: 'docs',
          path: '.',
        },
        {
          command: 'pnpm docs:build',
          env: [],
          include: ['../package.json'],
          outputDirectory: 'dist',
          packages: {
            build: [],
            runtime: [],
          },
          strategy: 'auto',
        },
      ),
    ).resolves.toMatchObject({
      buildCommand: 'pnpm docs:build',
      buildContextDirectory: join(tempDirectory, 'src'),
      outputDirectory: 'dist',
      packer: 'static',
      sourceBuildInput: {
        staticOutputDirectory: 'public-docs/dist',
      },
      serviceRelativePath: 'public-docs',
    });
  });

  it('returns the authored Railpack build command when the service resolves to Railpack', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
      },
      createRootSourcePackageMetadata(),
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', 'apps/web'),
        createResolvedBuildConfig('railpack', 'pnpm build'),
      ),
    ).resolves.toMatchObject({
      buildCommand: 'pnpm build',
      packer: 'railpack',
    });
  });

  it('rejects build commands when the service resolves to Dockerfile', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/Dockerfile': 'FROM node:24-alpine\n',
        'apps/web/package.json': '{"name":"web"}\n',
      },
      createRootSourcePackageMetadata(),
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', 'apps/web'),
        createResolvedBuildConfig('auto', 'pnpm build'),
      ),
    ).rejects.toThrow('resolved to Dockerfile build');
  });

  it('rejects build packages when the service resolves to Dockerfile', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/Dockerfile': 'FROM node:24-alpine\n',
        'apps/web/package.json': '{"name":"web"}\n',
      },
      createRootSourcePackageMetadata(),
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', 'apps/web'),
        createResolvedBuildConfig('auto', undefined, {
          build: [],
          runtime: ['libnss3'],
        }),
      ),
    ).rejects.toThrow('resolved to Dockerfile build');
  });

  it('rejects explicit dockerfile strategies when the service directory has no Dockerfile', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
      },
      createRootSourcePackageMetadata(),
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', 'apps/web'),
        createResolvedBuildConfig('dockerfile'),
      ),
    ).rejects.toThrow('requires a Dockerfile');
  });

  it('fails early when the configured service directory does not exist in the source archive', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
      },
      createRootSourcePackageMetadata(),
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', 'apps/api'),
        createResolvedBuildConfig(),
      ),
    ).rejects.toThrow('Service directory "apps/api" does not exist in the uploaded source archive.');
  });

  it('rejects absolute service paths before packer detection', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
      },
      createRootSourcePackageMetadata(),
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', '/tmp/compartment-escape'),
        createResolvedBuildConfig(),
      ),
    ).rejects.toThrow('Service path "/tmp/compartment-escape" must be relative to the uploaded source archive root.');
  });

  it('rejects service paths that escape the extracted source archive', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
      },
      createRootSourcePackageMetadata(),
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', '../outside'),
        createResolvedBuildConfig(),
      ),
    ).rejects.toThrow('Service path "../outside" must stay within the uploaded source archive.');
  });

  it('rejects archives without source-package metadata', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive({
      'apps/web/package.json': '{"name":"web"}\n',
    });

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', 'apps/web'),
        createResolvedBuildConfig(),
      ),
    ).rejects.toThrow('Uploaded source archive is missing source-package metadata.');
  });

  it('rejects metadata descriptor directories that do not contain compartment.yml', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
      },
      {
        descriptorDirectoryRelativePath: 'apps/web',
        version: 1,
      },
      {},
      false,
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', '.'),
        createResolvedBuildConfig(),
      ),
    ).rejects.toThrow('Uploaded source archive metadata descriptor directory must contain compartment.yml.');
  });

  it('rejects metadata descriptor directories when compartment.yml resolves to a directory', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/compartment.yml/placeholder': 'not a descriptor file\n',
        'apps/web/package.json': '{"name":"web"}\n',
      },
      {
        descriptorDirectoryRelativePath: 'apps/web',
        version: 1,
      },
      {},
      false,
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', '.'),
        createResolvedBuildConfig(),
      ),
    ).rejects.toThrow('Uploaded source archive metadata descriptor directory must contain compartment.yml.');
  });

  it('rejects metadata descriptor directories that omit compartment.routes.yml when routes are supplied', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/compartment.yml': 'name: smoke-web\nservices:\n  web: .\n',
        'apps/web/package.json': '{"name":"web"}\n',
      },
      {
        descriptorDirectoryRelativePath: 'apps/web',
        version: 1,
      },
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', '.'),
        createResolvedBuildConfig(),
        true,
      ),
    ).rejects.toThrow('Uploaded source archive metadata descriptor directory must contain compartment.routes.yml.');
  });

  it('rejects symlinked service paths before build execution', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
      },
      createRootSourcePackageMetadata(),
      {
        'apps/web-link': '/tmp',
      },
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', 'apps/web-link'),
        createResolvedBuildConfig(),
      ),
    ).rejects.toThrow('contains unsupported entry type');
  });

  it('rejects symlink entries inside the inferred build context', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
      },
      createRootSourcePackageMetadata(),
      {
        'apps/web/escape-link': '/tmp',
      },
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', 'apps/web'),
        createResolvedBuildConfig(),
      ),
    ).rejects.toThrow('contains unsupported entry type');
  });

  it('rejects metadata that overrides the claimed service path', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
      },
      {
        descriptorDirectoryRelativePath: 'apps/web',
        servicePaths: {
          web: 'other',
        },
        version: 1,
      },
    );

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', '.'),
        createResolvedBuildConfig(),
      ),
    ).rejects.toThrow('Uploaded source archive metadata must not override service path for "web".');
  });

  it('rethrows non-ENOENT Dockerfile access failures instead of falling back to railpack', async (): Promise<void> => {
    const tempDirectory: string = await createTrackedTempDirectory('compartment-worker-source-');
    const sourceArchive: Buffer = await createSourceArchive(
      {
        'apps/web/package.json': '{"name":"web"}\n',
      },
      createRootSourcePackageMetadata(),
    );
    const accessError: Error = createFileSystemError('EACCES', 'permission denied');
    mocks.stat.mockRejectedValueOnce(accessError);

    await expect(
      prepareServiceDirectory(
        tempDirectory,
        sourceArchive,
        createServiceInput('web', 'apps/web'),
        createResolvedBuildConfig(),
      ),
    ).rejects.toBe(accessError);
  });
});

function createServiceInput(name: string, path: string): WorkerSourceServiceInput {
  return {
    kind: 'web',
    name,
    path,
  };
}

function createResolvedBuildConfig(
  strategy: ServiceBuildStrategy = 'auto',
  command?: string,
  packages: ServiceBuildPackages = {
    build: [],
    runtime: [],
  },
  include: string[] = [],
): ResolvedCompartmentServiceBuildConfig {
  return {
    ...(command !== undefined ? { command } : {}),
    env: [],
    include,
    packages,
    strategy,
  };
}

function createRootSourcePackageMetadata(): CompartmentSourcePackageMetadata {
  return {
    descriptorDirectoryRelativePath: '.',
    version: 1,
  };
}

async function createSourceArchive(
  files: Record<string, string>,
  sourcePackageMetadata?: CompartmentSourcePackageMetadata,
  symlinks: Record<string, string> = {},
  includeDescriptorFile: boolean = true,
): Promise<Buffer> {
  const sourceDirectory: string = await createTrackedTempDirectory('compartment-worker-source-archive-');
  const archiveDirectory: string = await createTrackedTempDirectory('compartment-worker-source-archive-file-');
  const archivePath: string = join(archiveDirectory, 'source.tgz');

  await writeSourceFiles(sourceDirectory, buildSourceFiles(files, sourcePackageMetadata, includeDescriptorFile));
  await writeSourceSymlinks(sourceDirectory, symlinks);
  if (sourcePackageMetadata !== undefined) {
    await writeSourceFiles(sourceDirectory, {
      '.compartment/source-package.json': serializeCompartmentSourcePackageMetadata(sourcePackageMetadata),
    });
  }
  await executeFileAsync('tar', ['-czf', archivePath, '-C', sourceDirectory, '.']);

  const archiveContents: Buffer = await readFile(archivePath);

  return archiveContents;
}

function buildSourceFiles(
  files: Record<string, string>,
  sourcePackageMetadata: CompartmentSourcePackageMetadata | undefined,
  includeDescriptorFile: boolean,
): Record<string, string> {
  if (sourcePackageMetadata === undefined || !includeDescriptorFile) {
    return files;
  }

  const descriptorFilePath: string = joinCompartmentSourcePackageRelativePath(
    sourcePackageMetadata.descriptorDirectoryRelativePath,
    'compartment.yml',
  );

  return {
    ...files,
    [descriptorFilePath]: files[descriptorFilePath] ?? 'name: smoke-web\n',
  };
}

async function writeSourceFiles(sourceDirectory: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]: [string, string]): Promise<void> => {
      const filePath: string = join(sourceDirectory, relativePath);
      await mkdir(join(filePath, '..'), { recursive: true });
      await writeFile(filePath, contents);
    }),
  );
}

async function writeSourceSymlinks(sourceDirectory: string, symlinks: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(symlinks).map(async ([relativePath, targetPath]: [string, string]): Promise<void> => {
      const filePath: string = join(sourceDirectory, relativePath);
      await mkdir(join(filePath, '..'), { recursive: true });
      await symlink(targetPath, filePath);
    }),
  );
}

async function createTrackedTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.push(directory);

  return directory;
}

function createFileSystemError(code: string, message: string): Error {
  const error: Error & { code?: string } = new Error(message);
  error.code = code;

  return error;
}
