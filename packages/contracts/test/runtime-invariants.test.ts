import {
  buildCompartmentArtifactImageRepository,
  buildCompartmentArtifactImageTag,
  buildNodeDrainDeploymentRequest,
  buildNodeInspectReadinessFields,
  gitDescriptorPlanResponseSchema,
  gitDescriptorPullRequestResponseSchema,
  gitDescriptorPullRequestStatusResponseSchema,
  isDeployableCompartmentServiceKind,
  isRoutableCompartmentServiceKind,
  nodeInspectDeploymentQuerySchema,
  nodeResourceDeleteRequestSchema,
  nodeResourceStopRequestSchema,
  parseCompartmentSourcePackageMetadata,
  readCompartmentSourcePackageLiteralArchiveEntryPath,
  readCompartmentSourcePackageBuildContextArchivePath,
  readCompartmentSourcePackageServiceArchivePath,
  readWorkerUpstreamTargetPresence,
  readCompartmentSourcePackageValidatedServicePath,
  normalizeCompartmentSourcePackageRelativePath,
  readNodeInspectReadiness,
  type CompartmentSourcePackageMetadata,
  type NodeResourceDeleteRequest,
  type ResolvedCompartmentServiceBuildExecution,
  type NodeInspectDeploymentQuery,
  type ResolvedCompartmentServiceBuildConfig,
  type ResolvedCompartmentServiceRunConfig,
  resolveServiceReadinessConfig,
  resolveCompartmentServiceBuildConfig,
  resolveCompartmentServiceBuildExecution,
  resolveCompartmentServiceRunConfig,
  resolveCompartmentServiceRunExecution,
  workerCompleteDeploymentRequestSchema,
  workerUpdateDeploymentRuntimeRequestSchema,
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

    expect(imageRepository).toBe('compartment/projects/prj_123/services/svc_123');
    expect(buildCompartmentArtifactImageTag('127.0.0.1:5517', imageRepository, 'art_123')).toBe(
      '127.0.0.1:5517/compartment/projects/prj_123/services/svc_123:art_123',
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

  it('defaults omitted run config to on-failure restart behavior', (): void => {
    expect(resolveCompartmentServiceRunConfig(undefined)).toEqual({
      restart: {
        policy: 'on-failure',
      },
    });
    expect(resolveCompartmentServiceRunConfig({ command: 'pnpm start' })).toEqual({
      command: 'pnpm start',
      restart: {
        policy: 'on-failure',
      },
    });
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

  it('rejects non-HTTPS descriptor pull request URLs', (): void => {
    expect((): void => {
      gitDescriptorPullRequestResponseSchema.parse({
        descriptorPath: 'compartment.yml',
        pullRequestNumber: 42,
        pullRequestUrl: 'javascript:alert(1)',
        state: 'open',
        statusToken: 'status-token',
      });
    }).toThrow('Pull request URL must use HTTPS.');
  });

  it('parses nested worker drain state and clear semantics', (): void => {
    expect(
      workerCompleteDeploymentRequestSchema.parse({
        containerId: 'container_123',
        deploymentId: 'dep_123',
        drain: {
          drainDeadlineAt: '2026-03-24T10:00:05.000Z',
          drainingContainerId: 'legacy_container_123',
          drainingDeploymentId: 'dep_previous',
          drainingNodeId: 'node_previous',
        },
        imageRef: 'sha256:image',
        routeHost: 'smoke-web.localhost',
        upstreamHost: '127.0.0.1',
        upstreamPort: 31000,
      }).drain?.drainingDeploymentId,
    ).toBe('dep_previous');

    expect(
      workerUpdateDeploymentRuntimeRequestSchema.parse({
        deploymentId: 'dep_123',
        drain: null,
        promotionStage: 'active',
      }).drain,
    ).toBeNull();
  });

  it('allows stopped resource deletes without weakening stop requests', (): void => {
    const lifecyclePayload: Pick<
      NodeResourceDeleteRequest,
      'environmentName' | 'projectName' | 'resourceName' | 'volumes'
    > = {
      environmentName: 'production',
      projectName: 'billing',
      resourceName: 'postgres',
      volumes: [],
    };

    expect(
      nodeResourceDeleteRequestSchema.parse({
        ...lifecyclePayload,
        containerId: null,
      }).containerId,
    ).toBeNull();
    expect(
      nodeResourceStopRequestSchema.safeParse({
        ...lifecyclePayload,
        containerId: null,
      }).success,
    ).toBe(false);
  });

  it('maps runtime drain state to the node drain request DTO', (): void => {
    expect(
      buildNodeDrainDeploymentRequest({
        drainDeadlineAt: '2026-03-24T10:00:05.000Z',
        drainingContainerId: 'legacy_container_123',
        drainingDeploymentId: 'dep_previous',
        drainingNodeId: 'node_previous',
      }),
    ).toEqual({
      containerId: 'legacy_container_123',
      deploymentId: 'dep_previous',
      drainDeadlineAt: '2026-03-24T10:00:05.000Z',
    });
  });

  it('reuses canonical worker upstream-target presence rules', (): void => {
    expect(readWorkerUpstreamTargetPresence({})).toBe('absent');
    expect(readWorkerUpstreamTargetPresence({ upstreamHost: '127.0.0.1' })).toBe('missing_port');
    expect(readWorkerUpstreamTargetPresence({ upstreamPort: 31000 })).toBe('missing_host');
    expect(readWorkerUpstreamTargetPresence({ upstreamHost: '127.0.0.1', upstreamPort: 31000 })).toBe('complete');
  });

  it('maps inspect readiness between flat query fields and resolved readiness', (): void => {
    const query: NodeInspectDeploymentQuery = nodeInspectDeploymentQuerySchema.parse({
      deploymentId: 'dep_123',
      environmentName: 'production',
      projectName: 'smoke-web',
      readinessPath: '/healthz',
      readinessTimeoutMs: '30000',
      readinessType: 'http',
      serviceName: 'web',
    });

    expect(buildNodeInspectReadinessFields(readNodeInspectReadiness(query) ?? undefined)).toEqual({
      readinessPath: '/healthz',
      readinessTimeoutMs: 30000,
      readinessType: 'http',
    });
  });

  it('rejects partial inspect readiness query fields', (): void => {
    expect((): void => {
      nodeInspectDeploymentQuerySchema.parse({
        deploymentId: 'dep_123',
        environmentName: 'production',
        projectName: 'smoke-web',
        readinessPath: '/healthz',
        serviceName: 'web',
      });
    }).toThrow('must be provided together');
  });
});
