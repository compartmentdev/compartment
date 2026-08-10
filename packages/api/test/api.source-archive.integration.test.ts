import {
  compartmentSourcePackageMetadataArchivePath,
  errorResponseSchema,
  type InstallResponse,
  type SourceUploadSummary,
  type TenantSecretEnvelope,
  type WorkerClaimedDeployment,
  compartmentCurrentOrganizationHeaderName,
} from '@compartment/contracts';
import { readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';

import {
  buildArtifacts,
  deployments,
  environments,
  projectResources,
  projectServices,
  projects,
  sourceUploads,
} from '../src/db/schema';
import { resolveSourceUploadArchivePath } from '../src/services/source-upload-storage.service';

import {
  claimNextQueuedDeployment,
  fetchArtifactSourceArchive,
  createExpectedRunConfig,
  createUploadedSourceArchive,
  createRawSourceArchive,
  createSourceArchive,
  createMultiServiceDescriptor,
  createMultiServiceRoutes,
  injectDeployRequest,
  injectJsonDeployRequest,
  injectSourceUploadRequest,
  installCompartment,
  requireClaimedDeployment,
  requireClaimedDeploymentByServiceName,
  requireTenantSecretEnvelope,
  setVariable,
  type RawSourceArchiveEntry,
} from './api-integration.harness';
import type { StoredBuildArtifactRow } from './api.integration.types';
import {
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTempDirectory,
  configureApiRuntimeWithPublicIngress,
  resetApiIntegrationTempDirectory,
} from './api-app-test.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';

type InvalidateEdgeAppAccessSessions = () => Promise<void>;
type SynchronizeEdgeAppAccessState = () => Promise<void>;
type ResolveDnsRecord = (hostname: string) => Promise<string[]>;
type ResolveTxtRecord = (hostname: string) => Promise<string[][]>;

interface AppAccessEdgeServiceMocks {
  invalidateEdgeAppAccessSessions: Mock<InvalidateEdgeAppAccessSessions>;
  synchronizeEdgeAppAccessState: Mock<SynchronizeEdgeAppAccessState>;
}

interface DnsPromiseMocks {
  resolve4: Mock<ResolveDnsRecord>;
  resolve6: Mock<ResolveDnsRecord>;
  resolveCname: Mock<ResolveDnsRecord>;
  resolveTxt: Mock<ResolveTxtRecord>;
}

interface AuthoredRailpackBuildConfig {
  command?: string | undefined;
  env?: string[] | undefined;
  strategy: 'railpack';
}

const appAccessEdgeServiceMocks: AppAccessEdgeServiceMocks = vi.hoisted(
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: vi.fn<InvalidateEdgeAppAccessSessions>(),
    synchronizeEdgeAppAccessState: vi.fn<SynchronizeEdgeAppAccessState>(),
  }),
);

const dnsPromiseMocks: DnsPromiseMocks = vi.hoisted(
  (): DnsPromiseMocks => ({
    resolve4: vi.fn<ResolveDnsRecord>(),
    resolve6: vi.fn<ResolveDnsRecord>(),
    resolveCname: vi.fn<ResolveDnsRecord>(),
    resolveTxt: vi.fn<ResolveTxtRecord>(),
  }),
);

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions,
    synchronizeEdgeAppAccessState: appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState,
  }),
);

vi.mock(
  'node:dns/promises',
  (): DnsPromiseMocks => ({
    resolve4: dnsPromiseMocks.resolve4,
    resolve6: dnsPromiseMocks.resolve6,
    resolveCname: dnsPromiseMocks.resolveCname,
    resolveTxt: dnsPromiseMocks.resolveTxt,
  }),
);

const {
  apiConfig: defaultApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testTempDirectory,
} = createApiIntegrationTestContext('api_integration_source_archive', 'api-integration-source-archive');
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration source archive', (): void => {
  useApiDatabaseTestHarness(apiIntegrationDatabaseUrl);

  beforeEach(async (): Promise<void> => {
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockReset();
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockResolvedValue(undefined);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockReset();
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockResolvedValue(undefined);
    dnsPromiseMocks.resolve4.mockReset();
    dnsPromiseMocks.resolve4.mockResolvedValue(['203.0.113.10']);
    dnsPromiseMocks.resolve6.mockReset();
    dnsPromiseMocks.resolve6.mockRejectedValue(new Error('No AAAA record.'));
    dnsPromiseMocks.resolveCname.mockReset();
    dnsPromiseMocks.resolveCname.mockRejectedValue(new Error('No CNAME record.'));
    dnsPromiseMocks.resolveTxt.mockReset();
    dnsPromiseMocks.resolveTxt.mockRejectedValue(new Error('No TXT record.'));
    await resetApiIntegrationTempDirectory(testTempDirectory);
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(defaultApiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db);
    hasInitializedApiIntegrationRuntime = true;
  });
  afterAll(async (): Promise<void> => {
    await cleanupApiIntegrationTempDirectory(testTempDirectory);
  });
  afterEach(async (): Promise<void> => {
    vi.unstubAllGlobals();
    if (!hasInitializedApiIntegrationRuntime) {
      return;
    }

    hasInitializedApiIntegrationRuntime = false;
    await cleanupApiIntegrationRuntime(app, systemApp, pool);
  });
  it('rejects absolute manifest entry paths before extracting the uploaded source archive', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              build: {
                strategy: 'railpack',
              },
              path: '.',
            },
          },
        },
        sourceArchive: createRawSourceArchive(
          [
            {
              contents: 'name: smoke-web\nservices:\n  web: .\n',
              path: 'apps/web/compartment.yml',
              type: 'file',
            },
            {
              contents: '{"name":"web"}\n',
              path: '/apps/web/package.json',
              type: 'file',
            },
          ],
          {
            descriptorDirectoryRelativePath: 'apps/web',
            version: 1,
          },
        ),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('rejects non-literal manifest entry paths before extracting the uploaded source archive', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              build: {
                strategy: 'railpack',
              },
              path: '.',
            },
          },
        },
        sourceArchive: createRawSourceArchive(
          [
            {
              contents: 'name: smoke-web\nservices:\n  web: .\n',
              path: 'apps/web/compartment.yml',
              type: 'file',
            },
            {
              contents: '{"name":"web"}\n',
              path: 'apps/web/../package.json',
              type: 'file',
            },
          ],
          {
            descriptorDirectoryRelativePath: 'apps/web',
            version: 1,
          },
        ),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('rejects malformed gzip-compressed source archives before creating deployments', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        sourceArchive: gzipSync(Buffer.from('not-a-tarball', 'utf8')),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('rejects source uploads that end with an orphaned GNU long path header', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      createOrphanGnuLongPathArchive(),
    );

    expect(sourceUploadResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('rejects source uploads that contain unsupported GNU long link headers', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      createUnsupportedGnuLongLinkArchive(),
    );

    expect(sourceUploadResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('rejects malformed source-package metadata addressed through a GNU long path header', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      createGnuLongPathMetadataArchive('not-json'),
    );

    expect(sourceUploadResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('rejects malformed source-package metadata addressed through a local PAX header', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      createPaxMetadataArchive('not-json'),
    );

    expect(sourceUploadResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('rejects source uploads that use global PAX path overrides for source-package metadata', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      createGlobalPaxMetadataArchive('not-json'),
    );

    expect(sourceUploadResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('rejects malformed global PAX headers before creating source uploads', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      createMalformedGlobalPaxArchive(),
    );

    expect(sourceUploadResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('rejects oversized GNU long path headers before creating source uploads', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      createOversizedGnuLongPathArchive(),
    );

    expect(sourceUploadResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('rejects source archives that exceed the validation entry limit before creating deployments', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceArchiveEntryCountBefore: number = await readSourceArchiveDirectoryEntryCount(
      defaultApiConfig.sourceArchiveDirectory,
    );

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        sourceArchive: createValidationEntryLimitArchive(),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
    expect(await readSourceArchiveDirectoryEntryCount(defaultApiConfig.sourceArchiveDirectory)).toBe(
      sourceArchiveEntryCountBefore,
    );
  });

  it('rejects source archives that exceed the validation entry limit with transport headers', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceArchiveEntryCountBefore: number = await readSourceArchiveDirectoryEntryCount(
      defaultApiConfig.sourceArchiveDirectory,
    );

    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      createTransportHeaderEntryLimitArchive(),
    );

    expect(sourceUploadResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
    expect(await readSourceArchiveDirectoryEntryCount(defaultApiConfig.sourceArchiveDirectory)).toBe(
      sourceArchiveEntryCountBefore,
    );
  });

  it('rejects service paths that resolve through symlinked archive entries', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              build: {
                strategy: 'railpack',
              },
              path: 'root/tmp',
            },
          },
        },
        sourceArchive: await createSourceArchive(
          {
            'compartment.yml': 'name: smoke-web\nservices:\n  web:\n    path: root/tmp\n',
            'package.json': '{"name":"web"}\n',
          },
          undefined,
          {
            root: '/',
          },
        ),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('rejects symlinked build.include paths inside the uploaded source archive', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              build: {
                include: ['../../outside-link'],
                strategy: 'railpack',
              },
              path: '.',
            },
          },
        },
        sourceArchive: await createSourceArchive(
          {
            'apps/web/compartment.yml': 'name: smoke-web\nservices:\n  web: .\n',
            'apps/web/package.json': '{"name":"web"}\n',
          },
          {
            descriptorDirectoryRelativePath: 'apps/web',
            version: 1,
          },
          {
            'outside-link': '/tmp',
          },
        ),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('rejects symlink entries inside the final build context', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              build: {
                strategy: 'railpack',
              },
              path: '.',
            },
          },
        },
        sourceArchive: await createSourceArchive(
          {
            'apps/web/compartment.yml': 'name: smoke-web\nservices:\n  web: .\n',
            'apps/web/package.json': '{"name":"web"}\n',
          },
          {
            descriptorDirectoryRelativePath: 'apps/web',
            version: 1,
          },
          {
            'apps/web/escape-link': '/tmp',
          },
        ),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('marks claimed deployments that require source routes file validation', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
      await createSourceArchive({
        'compartment.yml':
          'name: smoke-multi-service\nservices:\n  backoffice:\n    path: ./services/backoffice\n  web:\n    path: ./services/web\n',
        'services/backoffice/package.json': '{"name":"backoffice"}\n',
        'services/web/package.json': '{"name":"web"}\n',
      }),
    );

    const deployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createMultiServiceDescriptor(),
        routes: createMultiServiceRoutes(),
        sourceUploadId: sourceUpload.id,
      },
    );

    expect(deployResponse.statusCode).toBe(200);
    const claimedDeployments: WorkerClaimedDeployment[] = [
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
    ];

    expect(requireClaimedDeploymentByServiceName(claimedDeployments, 'web').requiresSourceRoutesFile).toBe(true);
  });

  it('does not serve artifact source archives from symlinked source upload storage', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
      await createSourceArchive({
        'compartment.yml': 'name: smoke-web\nservices:\n  web: .\n',
        'package.json': '{"name":"web"}\n',
      }),
    );
    const deployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        sourceUploadId: sourceUpload.id,
      },
    );
    expect(deployResponse.statusCode).toBe(200);
    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    const sourceUploadArchivePath: string = resolveSourceUploadArchivePath(sourceUpload.id);
    const outsideArchivePath: string = join(testTempDirectory, `${sourceUpload.id}-outside.tgz`);
    await writeFile(outsideArchivePath, 'outside archive');
    await rm(sourceUploadArchivePath, { force: true });
    await symlink(outsideArchivePath, sourceUploadArchivePath);

    try {
      const sourceArchiveResponse: LightMyRequestResponse = await fetchArtifactSourceArchive(
        app,
        claimedDeployment.artifact.id,
      );

      expect(sourceArchiveResponse.statusCode).toBe(500);
      expect(errorResponseSchema.parse(sourceArchiveResponse.json()).error.code).toBe('internal_error');
      expect(sourceArchiveResponse.body).not.toBe('outside archive');
    } finally {
      await Promise.all([rm(sourceUploadArchivePath, { force: true }), rm(outsideArchivePath, { force: true })]);
    }
  });

  it('serves artifact source archives from PostgreSQL when the local replica has no file', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
      await createSourceArchive({
        'compartment.yml': 'name: smoke-web\nservices:\n  web: .\n',
        'package.json': '{"name":"web"}\n',
      }),
    );
    const deployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        sourceUploadId: sourceUpload.id,
      },
    );
    expect(deployResponse.statusCode).toBe(200);
    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    const sourceUploadArchivePath: string = resolveSourceUploadArchivePath(sourceUpload.id);
    await rm(sourceUploadArchivePath, { force: true });

    const sourceArchiveResponse: LightMyRequestResponse = await fetchArtifactSourceArchive(
      app,
      claimedDeployment.artifact.id,
    );

    expect(sourceArchiveResponse.statusCode).toBe(200);
    expect(sourceArchiveResponse.body.length).toBeGreaterThan(0);
  });

  it('rejects root-descriptor archives without source-package metadata', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        sourceArchive: await createSourceArchive(
          {
            'compartment.yml': 'name: smoke-web\nservices:\n  web: .\n',
            'package.json': '{"name":"web"}\n',
            'samples/nested/compartment.yml': 'name: nested\nservices:\n  web: .\n',
            'samples/nested/package.json': '{"name":"nested"}\n',
          },
          null,
        ),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
  });

  it('queues missing service-directory validation for canonical source-upload submits', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
      await createSourceArchive(
        {
          'compartment.yml': 'name: smoke-web\nservices:\n  web:\n    path: ./apps/web\n',
          'package.json': '{"name":"root"}\n',
        },
        {
          descriptorDirectoryRelativePath: '.',
          servicePaths: {
            web: 'services/web',
          },
          version: 1,
        },
      ),
    );

    const deployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              build: {
                strategy: 'railpack',
              },
              path: './apps/web',
            },
          },
        },
        sourceUploadId: sourceUpload.id,
      },
    );

    expect(deployResponse.statusCode).toBe(200);
    expect(requireClaimedDeployment(await claimNextQueuedDeployment(app))).toMatchObject({
      service: {
        path: './apps/web',
      },
    });
  });

  it('rejects dockerfile build packages even when the service directory contains a Dockerfile', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              build: {
                packages: {
                  runtime: ['libnss3'],
                },
                strategy: 'dockerfile',
              },
              path: './services/web',
            },
          },
        },
        sourceArchive: await createSourceArchive({
          'services/web/Dockerfile': 'FROM node:24-alpine\n',
          'services/web/package.json': '{"name":"web"}\n',
        }),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_deploy_request');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
  });

  it('rejects deployment labels with non-printable characters', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        label: 'hotfix\t\u001b[31mauth',
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_deploy_request');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
  });

  it('freezes selected plain build variables in an encrypted artifact snapshot before worker claim', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const authoredBuild: AuthoredRailpackBuildConfig = {
      env: ['VITE_PUBLIC_GREETING'],
      strategy: 'railpack',
    };

    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      keyName: 'VITE_PUBLIC_GREETING',
      projectName: 'smoke-web',
      value: 'hello from build env',
    });

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              build: authoredBuild,
              path: './services/web',
            },
          },
        },
        sourceArchive: await createSourceArchive(
          {
            'compartment.yml': 'name: smoke-web\nservices:\n  web:\n    path: ./services/web\n',
            'services/web/package.json': '{"name":"web"}\n',
          },
          {
            descriptorDirectoryRelativePath: '.',
            version: 1,
          },
        ),
      },
    );

    expect(deployResponse.statusCode).toBe(200);
    const storedArtifact: StoredBuildArtifactRow = (await db.select().from(buildArtifacts))[0]!;

    expect(storedArtifact.resolvedBuildEnvJson).toContain('VITE_PUBLIC_GREETING');
    expect(storedArtifact.resolvedBuildEnvJson).not.toContain('hello from build env');

    const removeVariableResponse: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: '/v1/variables/VITE_PUBLIC_GREETING?projectName=smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(removeVariableResponse.statusCode).toBe(200);

    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    const greeting: TenantSecretEnvelope = requireTenantSecretEnvelope(
      claimedDeployment.buildEnv,
      'VITE_PUBLIC_GREETING',
    );
    expect(greeting.encryptionKeyId).toMatch(/^tenant-kek-sha256:/);
    expect(greeting.valueCiphertext).toBeTypeOf('string');
    expect(JSON.stringify(claimedDeployment.buildEnv)).not.toContain('hello from build env');
    expect(claimedDeployment.run).toEqual(createExpectedRunConfig());
  });

  it('ignores unrelated runtime resource-output bindings during build env validation on first deploy', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      keyName: 'LOG_LEVEL',
      projectName: 'smoke-web',
      value: 'info',
    });
    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      fromResource: 'postgres.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'smoke-web',
      serviceName: 'web',
    });

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              build: {
                env: ['LOG_LEVEL'],
                strategy: 'railpack',
              },
              path: './services/web',
            },
          },
        },
        sourceArchive: await createSourceArchive({
          'services/web/package.json': '{"name":"web"}\n',
        }),
      },
    );

    expect(deployResponse.statusCode).toBe(200);
    await insertPostgresResource('smoke-web');
    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));

    const logLevel: TenantSecretEnvelope = requireTenantSecretEnvelope(claimedDeployment.buildEnv, 'LOG_LEVEL');
    expect(logLevel.encryptionKeyId).toMatch(/^tenant-kek-sha256:/);
    expect(logLevel.valueCiphertext).toBeTypeOf('string');
  });

  it('rejects build env keys backed by runtime resource-output bindings', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      keyName: 'LOG_LEVEL',
      projectName: 'smoke-web',
      value: 'info',
    });
    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      fromResource: 'postgres.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'smoke-web',
      serviceName: 'web',
    });

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              build: {
                env: ['DATABASE_URL'],
                strategy: 'railpack',
              },
              path: './services/web',
            },
          },
        },
        sourceArchive: await createSourceArchive({
          'services/web/package.json': '{"name":"web"}\n',
        }),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_deploy_config');
    expect(deployResponse.body).toContain('Resource outputs resolve at runtime');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
  });

  it('rejects build env keys that are missing from the resolved target variable set', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              build: {
                env: ['VITE_PUBLIC_GREETING'],
                strategy: 'railpack',
              },
              path: './services/web',
            },
          },
        },
        sourceArchive: await createSourceArchive({
          'services/web/package.json': '{"name":"web"}\n',
        }),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_deploy_config');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select({ name: projects.name }).from(projects)).toEqual([{ name: 'smoke-web' }]);
    expect(await db.select().from(environments)).toHaveLength(0);
    expect(await db.select().from(projectServices)).toHaveLength(0);
  });

  it('rejects sensitive variables in build env exposure', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      keyName: 'DATABASE_URL',
      projectName: 'smoke-web',
      sensitivity: 'sensitive',
      value: 'postgres://sensitive-build',
    });

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              build: {
                env: ['DATABASE_URL'],
                strategy: 'railpack',
              },
              path: './services/web',
            },
          },
        },
        sourceArchive: await createSourceArchive({
          'services/web/package.json': '{"name":"web"}\n',
        }),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_deploy_config');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select().from(projects)).toHaveLength(1);
    expect(await db.select().from(environments)).toHaveLength(1);
    expect(await db.select().from(projectServices)).toHaveLength(0);
  });
});

function createValidationEntryLimitArchive(): Buffer {
  const generatedEntries: RawSourceArchiveEntry[] = Array.from(
    { length: 12_000 },
    (_unused: undefined, index: number): RawSourceArchiveEntry => ({
      contents: '',
      path: `services/web/files/file-${index.toString().padStart(5, '0')}.txt`,
      type: 'file',
    }),
  );

  return createRawSourceArchive([
    {
      contents: 'name: smoke-web\nservices:\n  web: .\n',
      path: 'compartment.yml',
      type: 'file',
    },
    {
      contents: '{"name":"web"}\n',
      path: 'package.json',
      type: 'file',
    },
    ...generatedEntries,
  ]);
}

async function insertPostgresResource(projectName: string): Promise<void> {
  const project: typeof projects.$inferSelect = requireFixtureRow(
    (await db.select().from(projects)).find((row: typeof projects.$inferSelect): boolean => row.name === projectName),
    `${projectName} project`,
  );
  const environment: typeof environments.$inferSelect = requireFixtureRow(
    (await db.select().from(environments)).find(
      (row: typeof environments.$inferSelect): boolean => row.projectId === project.id && row.name === 'production',
    ),
    `${projectName} production environment`,
  );

  await db.insert(projectResources).values({
    commandJson: '[]',
    envJson: '[]',
    environmentId: environment.id,
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    outputsJson: '{"connection-url":{"sensitive":true,"value":"postgres://${resource.host}/app"}}',
    portsJson: '[]',
    readinessJson: 'null',
    runtimeDefinitionHash: 'hash_postgres',
    status: 'running',
    updatedAt: new Date('2026-05-15T00:00:00.000Z'),
    volumesJson: '[]',
  });
}

function requireFixtureRow<T>(row: T | undefined, label: string): T {
  if (row === undefined) {
    throw new Error(`Expected ${label} fixture row.`);
  }

  return row;
}

function createTransportHeaderEntryLimitArchive(): Buffer {
  const generatedEntries: RawSourceArchiveEntry[] = Array.from(
    { length: 12_000 },
    (_unused: undefined, index: number): RawSourceArchiveEntry => ({
      path: `GlobalPaxHeader/path-${index.toString().padStart(5, '0')}`,
      type: 'global-extended-header',
    }),
  );

  return createRawSourceArchive([
    ...generatedEntries,
    {
      contents: '{"name":"web"}\n',
      path: 'package.json',
      type: 'file',
    },
  ]);
}

function createOrphanGnuLongPathArchive(): Buffer {
  return createRawSourceArchive([createGnuLongPathArchiveEntry(compartmentSourcePackageMetadataArchivePath)], null);
}

function createUnsupportedGnuLongLinkArchive(): Buffer {
  return createRawSourceArchive([createGnuLongLinkArchiveEntry('services/web/package.json')], null);
}

function createGnuLongPathMetadataArchive(metadataContents: string): Buffer {
  return createRawSourceArchive(
    [
      createGnuLongPathArchiveEntry(compartmentSourcePackageMetadataArchivePath),
      {
        contents: metadataContents,
        path: 'metadata-placeholder.json',
        type: 'file',
      },
      {
        contents: '{"name":"web"}\n',
        path: 'package.json',
        type: 'file',
      },
    ],
    null,
  );
}

function createOversizedGnuLongPathArchive(): Buffer {
  return createRawSourceArchive([createGnuLongPathArchiveEntry('a'.repeat(2_000))], null);
}

function createPaxMetadataArchive(metadataContents: string): Buffer {
  return createRawSourceArchive(
    [
      createLocalPaxPathOverrideEntry(compartmentSourcePackageMetadataArchivePath),
      {
        contents: metadataContents,
        path: 'metadata-placeholder.json',
        type: 'file',
      },
      {
        contents: '{"name":"web"}\n',
        path: 'package.json',
        type: 'file',
      },
    ],
    null,
  );
}

function createGlobalPaxMetadataArchive(metadataContents: string): Buffer {
  return createRawSourceArchive(
    [
      createGlobalPaxPathOverrideEntry(compartmentSourcePackageMetadataArchivePath),
      {
        contents: metadataContents,
        path: 'metadata-placeholder.json',
        type: 'file',
      },
    ],
    null,
  );
}

function createMalformedGlobalPaxArchive(): Buffer {
  return createRawSourceArchive(
    [
      {
        contents: '11x path=a\n',
        path: 'GlobalPaxHeader/path',
        type: 'global-extended-header',
      },
    ],
    null,
  );
}

function createGnuLongPathArchiveEntry(path: string): RawSourceArchiveEntry {
  return {
    contents: `${path}\u0000`,
    path: '././@LongLink',
    type: 'long-path',
  };
}

function createGnuLongLinkArchiveEntry(path: string): RawSourceArchiveEntry {
  return {
    contents: `${path}\u0000`,
    path: '././@LongLink',
    type: 'long-link',
  };
}

function createGlobalPaxPathOverrideEntry(path: string): RawSourceArchiveEntry {
  return {
    contents: createPaxPathRecord(path),
    path: 'GlobalPaxHeader/path',
    type: 'global-extended-header',
  };
}

function createLocalPaxPathOverrideEntry(path: string): RawSourceArchiveEntry {
  return {
    contents: createPaxPathRecord(path),
    path: 'PaxHeader/path',
    type: 'extended-header',
  };
}

function createPaxPathRecord(path: string): string {
  const recordBody: string = `path=${path}\n`;
  let record: string = `0 ${recordBody}`;

  for (;;) {
    const nextRecord: string = `${Buffer.byteLength(record, 'utf8')} ${recordBody}`;
    if (nextRecord === record) {
      return record;
    }

    record = nextRecord;
  }
}

async function readSourceArchiveDirectoryEntryCount(sourceArchiveDirectory: string): Promise<number> {
  return (await readdir(sourceArchiveDirectory)).length;
}
