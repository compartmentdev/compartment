import {
  buildCompartmentArtifactImageRepository,
  buildCompartmentArtifactImageTag,
  gitDescriptorPlanResponseSchema,
  gitDescriptorPullRequestStatusResponseSchema,
  isDeployableCompartmentServiceKind,
  isRoutableCompartmentServiceKind,
  parseCompartmentSourcePackageMetadata,
  readCompartmentSourcePackageLiteralArchiveEntryPath,
  readCompartmentSourcePackageBuildContextArchivePath,
  readCompartmentSourcePackageServiceArchivePath,
  readCompartmentSourcePackageValidatedServicePath,
  normalizeCompartmentSourcePackageRelativePath,
  type CompartmentSourcePackageMetadata,
  type ResolvedCompartmentServiceBuildExecution,
  type ResolvedCompartmentServiceBuildConfig,
  type ResolvedCompartmentServiceRunConfig,
  resolveServiceReadinessConfig,
  resolveCompartmentServiceBuildConfig,
  resolveCompartmentServiceBuildExecution,
  resolveCompartmentServiceRunConfig,
  resolveCompartmentServiceRunExecution,
} from '../src';
import { describe, expect, it } from 'vitest';

describe('runtime invariants', (): void => {
  it('exposes deployable and routable service-kind helpers', (): void => {
    expect(isDeployableCompartmentServiceKind('web')).toBe(true);
    expect(isDeployableCompartmentServiceKind('static')).toBe(true);
    expect(isDeployableCompartmentServiceKind('worker')).toBe(false);
    expect(isRoutableCompartmentServiceKind('api')).toBe(true);
    expect(isRoutableCompartmentServiceKind('static')).toBe(true);
    expect(isRoutableCompartmentServiceKind('cron')).toBe(false);
  });

  it('builds canonical artifact image repository and tag values', (): void => {
    const imageRepository: string = buildCompartmentArtifactImageRepository('prj_123', 'svc_123');

    expect(imageRepository).toBe('projects/prj_123/services/svc_123');
    expect(buildCompartmentArtifactImageTag('127.0.0.1:5517', imageRepository, 'art_123')).toBe(
      '127.0.0.1:5517/projects/prj_123/services/svc_123:art_123',
    );
  });

  it('resolves auto build execution from dockerfile presence', (): void => {
    const build: ResolvedCompartmentServiceBuildConfig = resolveCompartmentServiceBuildConfig({
      command: 'pnpm build',
      strategy: 'auto',
    });

    expect(resolveCompartmentServiceBuildExecution(build, false, './web', 'web')).toEqual({
      buildAptPackages: [],
      buildCommand: 'pnpm build',
      packer: 'railpack',
      runtimeAptPackages: [],
    });
    expect((): void => {
      resolveCompartmentServiceBuildExecution(build, true, './web', 'web');
    }).toThrow('Build command is only supported for source-built services.');
  });

  it('forces static services onto the static packer even when a Dockerfile is present', (): void => {
    const build: ResolvedCompartmentServiceBuildConfig = resolveCompartmentServiceBuildConfig({
      outputDirectory: 'dist',
      strategy: 'auto',
    });

    expect(resolveCompartmentServiceBuildExecution(build, true, './site', 'static')).toEqual({
      buildAptPackages: [],
      outputDirectory: 'dist',
      packer: 'static',
      runtimeAptPackages: [],
    });
  });

  it('keeps run.command railpack-only after auto build resolution', (): void => {
    const build: ResolvedCompartmentServiceBuildConfig = resolveCompartmentServiceBuildConfig({
      strategy: 'auto',
    });
    const run: ResolvedCompartmentServiceRunConfig = resolveCompartmentServiceRunConfig({
      command: 'pnpm start',
    });

    expect(resolveCompartmentServiceBuildExecution(build, false, './web', 'web')).toEqual({
      buildAptPackages: [],
      packer: 'railpack',
      runtimeAptPackages: [],
    });
    expect(resolveCompartmentServiceRunExecution(run, 'railpack', './web')).toEqual(run);
    expect((): void => {
      const buildExecution: ResolvedCompartmentServiceBuildExecution = resolveCompartmentServiceBuildExecution(
        build,
        true,
        './web',
        'web',
      );
      resolveCompartmentServiceRunExecution(run, buildExecution.packer, './web');
    }).toThrow('Run command is only supported for services with an authored runtime process.');
  });

  it('keeps run config limited to the authored command', (): void => {
    expect(resolveCompartmentServiceRunConfig(undefined)).toEqual({});
    expect(resolveCompartmentServiceRunConfig({ command: 'pnpm start' })).toEqual({ command: 'pnpm start' });
  });

  it('disables readiness when the service omits readiness config', (): void => {
    expect(resolveServiceReadinessConfig(undefined)).toBeNull();
  });

  it('preserves authored build and runtime packages for railpack execution', (): void => {
    const build: ResolvedCompartmentServiceBuildConfig = resolveCompartmentServiceBuildConfig({
      packages: {
        build: ['build-essential'],
        runtime: ['libnss3', 'libxss1'],
      },
      strategy: 'railpack',
    });

    expect(resolveCompartmentServiceBuildExecution(build, false, './web', 'web')).toEqual({
      buildAptPackages: ['build-essential'],
      packer: 'railpack',
      runtimeAptPackages: ['libnss3', 'libxss1'],
    });
  });

  it('rejects non-literal source-package metadata paths', (): void => {
    expect((): void => {
      parseCompartmentSourcePackageMetadata('{"descriptorDirectoryRelativePath":"../apps/web","version":1}');
    }).toThrow('literal relative paths');
    expect((): void => {
      parseCompartmentSourcePackageMetadata('{"descriptorDirectoryRelativePath":"/apps/web","version":1}');
    }).toThrow('literal relative paths');
    expect((): void => {
      parseCompartmentSourcePackageMetadata(
        '{"descriptorDirectoryRelativePath":"apps/web","servicePaths":{"web":"./api"},"version":1}',
      );
    }).toThrow('literal relative paths');
    expect(
      parseCompartmentSourcePackageMetadata(
        '{"descriptorDirectoryRelativePath":"apps/web","servicePaths":{"api":"../api"},"version":1}',
      ),
    ).toMatchObject({
      descriptorDirectoryRelativePath: 'apps/web',
      servicePaths: {
        api: '../api',
      },
      version: 1,
    });
  });

  it('keeps source archive entry names literal', (): void => {
    expect(readCompartmentSourcePackageLiteralArchiveEntryPath('./apps/web/package.json')).toBe(
      'apps/web/package.json',
    );
    expect((): void => {
      readCompartmentSourcePackageLiteralArchiveEntryPath('apps/web/../package.json');
    }).toThrow('invalid entry path');
  });

  it('derives canonical service and build-context archive paths from source-package metadata', (): void => {
    const metadata: CompartmentSourcePackageMetadata = parseCompartmentSourcePackageMetadata(
      '{"descriptorDirectoryRelativePath":"apps/web","version":1}',
    );

    expect(readCompartmentSourcePackageServiceArchivePath('.', metadata)).toBe('apps/web');
    expect(readCompartmentSourcePackageBuildContextArchivePath('.', ['../../packages/shared'], metadata)).toBe('.');
    expect(readCompartmentSourcePackageValidatedServicePath('web', '.', metadata)).toBe('.');
    expect((): void => {
      readCompartmentSourcePackageValidatedServicePath(
        'web',
        '.',
        parseCompartmentSourcePackageMetadata(
          '{"descriptorDirectoryRelativePath":"apps/web","servicePaths":{"web":"other"},"version":1}',
        ),
      );
    }).toThrow('must not override service path');
  });

  it('normalizes source package paths without a Node runtime path dependency', (): void => {
    expect(normalizeCompartmentSourcePackageRelativePath('./apps/web/../api/')).toBe('apps/api');
    expect(normalizeCompartmentSourcePackageRelativePath('apps/web/../../../api')).toBe('../api');
    expect(normalizeCompartmentSourcePackageRelativePath('../api')).toBe('../api');
    expect(normalizeCompartmentSourcePackageRelativePath('.')).toBe('.');
  });

  it('accepts descriptor candidate paths for missing Git descriptors', (): void => {
    expect(
      gitDescriptorPlanResponseSchema.parse({
        branchName: 'main',
        candidates: [
          {
            appFolder: '.',
            descriptorPath: 'compartment.yml',
            files: [
              {
                content: 'name: app\n\nservices:\n  web: .\n',
                path: 'compartment.yml',
              },
            ],
            id: 'compartment_yml',
            packageJsonPath: null,
            projectName: 'app',
          },
        ],
        descriptorPath: null,
        preview: null,
        repositoryName: 'app',
        repositoryOwner: 'owner',
        status: 'descriptor_missing',
      }).candidates[0]?.appFolder,
    ).toBe('.');
  });

  it('keeps Git descriptor PR status responses status-only', (): void => {
    const parsed: {
      pullRequestNumber: number;
      pullRequestUrl: string;
      state: string;
    } = gitDescriptorPullRequestStatusResponseSchema.parse({
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/acme/mono/pull/42',
      state: 'merged',
    });

    expect(parsed).toEqual({
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/acme/mono/pull/42',
      state: 'merged',
    });
  });
});
