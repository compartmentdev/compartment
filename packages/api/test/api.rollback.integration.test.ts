import {
  type CompartmentAuthoredDescriptor,
  type CompartmentRoutesFile,
  deploymentInspectResponseSchema,
  deploymentListResponseSchema,
  deploymentStatusResponseSchema,
  deployResponseSchema,
  errorResponseSchema,
  type DeploymentInspectResponse,
  type DeploymentListResponse,
  type DeploymentStatusResponse,
  type DeploymentSummary,
  type DeployResponse,
  type InstallResponse,
  type ResolvedCompartmentServiceBuildConfig,
  type WorkerClaimedDeployment,
  compartmentCurrentOrganizationHeaderName,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';

import { auditEvents, buildArtifacts, environments } from '../src/db/schema';
import type { EnvironmentRow } from '../src/queries/deployments.query.types';

import {
  claimNextQueuedDeployment,
  completeClaimedDeployment,
  completeQueuedDeployment,
  createExpectedRunConfig,
  createSourceArchive,
  createMultiServiceDescriptor,
  createMultiServiceRoutes,
  injectDeployRequest,
  installCompartment,
  requireClaimedDeployment,
  requireClaimedDeploymentByServiceName,
  requireDeploymentByServiceName,
  requireDeployResponseDeployment,
  requireSingleDeployment,
  type ExpectedRunConfig,
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

interface CompletedDeployRunResult {
  claimedDeployments: WorkerClaimedDeployment[];
  deployPayload: DeployResponse;
}

interface AuthoredRunConfig {
  command: string;
}

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
} = createApiIntegrationTestContext('api_integration_rollback', 'api-integration-rollback');
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration rollback', (): void => {
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
  it('promotes an active deployment into another environment without creating a new build artifact row', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const authoredBuild: AuthoredRailpackBuildConfig = {
      command: 'pnpm build',
      strategy: 'railpack',
    };
    const expectedBuild: ResolvedCompartmentServiceBuildConfig = {
      command: 'pnpm build',
      env: [],
      include: [],
      packages: {
        build: [],
        runtime: [],
      },
      strategy: 'railpack',
    };
    const authoredRun: AuthoredRunConfig = {
      command: 'pnpm start',
    };
    const expectedRun: ExpectedRunConfig = createExpectedRunConfig('pnpm start');

    const stagingDeployResponse: LightMyRequestResponse = await injectDeployRequest(
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
              release: {
                command: 'pnpm db:migrate',
              },
              run: authoredRun,
            },
          },
        },
        environmentName: 'staging',
        label: 'release 42',
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
    expect(stagingDeployResponse.statusCode).toBe(200);
    const stagingPayload: DeployResponse = deployResponseSchema.parse(stagingDeployResponse.json());
    const stagingDeployment: DeploymentSummary = requireDeployResponseDeployment(stagingPayload);
    const claimedStagingDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    expect(claimedStagingDeployment.service.build).toEqual(expectedBuild);
    expect(claimedStagingDeployment.run).toEqual(expectedRun);
    const storedStagingArtifacts: StoredBuildArtifactRow[] = await db.select().from(buildArtifacts);
    expect(storedStagingArtifacts).toHaveLength(1);
    expect(JSON.parse(storedStagingArtifacts[0]?.resolvedBuildJson ?? 'null')).toEqual(expectedBuild);
    await completeClaimedDeployment(app, stagingDeployment.id, claimedStagingDeployment.routeHost);

    const promoteResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/deployments/promote',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
      payload: {
        projectName: 'smoke-web',
        sourceEnvironmentName: 'staging',
        targetEnvironmentName: 'production',
      },
    });
    expect(promoteResponse.statusCode).toBe(200);
    const promotePayload: DeployResponse = deployResponseSchema.parse(promoteResponse.json());
    const promotedDeployment: DeploymentSummary = requireDeployResponseDeployment(promotePayload);
    expect(promotedDeployment.id).not.toBe(stagingDeployment.id);
    expect(promotedDeployment.label).toBe('release 42');

    const storedArtifacts: StoredBuildArtifactRow[] = await db.select().from(buildArtifacts);
    expect(storedArtifacts).toHaveLength(1);

    const claimedPromotedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    expect(claimedPromotedDeployment.artifact.id).toBe(claimedStagingDeployment.artifact.id);
    expect(claimedPromotedDeployment.artifact.imageRef).toBe('registry.example/app@sha256:image');
    expect(claimedPromotedDeployment.service.build).toEqual(expectedBuild);
    expect(claimedPromotedDeployment.run).toEqual(expectedRun);
    await completeClaimedDeployment(app, promotedDeployment.id, claimedPromotedDeployment.routeHost);

    const deploymentListResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments?projectName=smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(deploymentListResponse.statusCode).toBe(200);
    const deploymentListPayload: DeploymentListResponse = deploymentListResponseSchema.parse(
      deploymentListResponse.json(),
    );
    expect(deploymentListPayload.environment).not.toBeNull();
    expect(deploymentListPayload.environment.name).toBe('production');
    expect(deploymentListPayload.deployments).toHaveLength(1);
    expect(requireSingleDeployment(deploymentListPayload.deployments).id).toBe(promotedDeployment.id);
    expect(requireSingleDeployment(deploymentListPayload.deployments).deploymentRunId).toBe(
      promotePayload.deploymentRunId,
    );
    expect(requireSingleDeployment(deploymentListPayload.deployments).label).toBe('release 42');
  });
  it('rejects deployment list when the default production environment does not exist yet', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const stagingDeployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        environmentName: 'staging',
      },
    );
    expect(stagingDeployResponse.statusCode).toBe(200);
    const stagingPayload: DeployResponse = deployResponseSchema.parse(stagingDeployResponse.json());
    const stagingDeployment: DeploymentSummary = requireDeployResponseDeployment(stagingPayload);
    const claimedStagingDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    await completeQueuedDeployment(app, stagingDeployment.id, claimedStagingDeployment.routeHost);

    const deploymentListResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments?projectName=smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(deploymentListResponse.statusCode).toBe(404);
    expect(errorResponseSchema.parse(deploymentListResponse.json()).error.code).toBe('environment_not_found');
  });
  it('rejects promote for a deployment without image reuse data and leaves the target environment untouched', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const stagingDeployPayload: DeployResponse = deployResponseSchema.parse(
      (
        await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
          environmentName: 'staging',
        })
      ).json(),
    );
    const stagingDeployment: DeploymentSummary = requireDeployResponseDeployment(stagingDeployPayload);
    const claimedStagingDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    await completeQueuedDeployment(app, stagingDeployment.id, claimedStagingDeployment.routeHost);
    await db
      .update(buildArtifacts)
      .set({
        imageRef: null,
        updatedAt: new Date(),
      })
      .where(eq(buildArtifacts.id, claimedStagingDeployment.artifact.id));

    const promoteResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/deployments/promote',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
      payload: {
        projectName: 'smoke-web',
        sourceEnvironmentName: 'staging',
        targetEnvironmentName: 'preview',
      },
    });

    expect(promoteResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(promoteResponse.json()).error.code).toBe('deployment_image_not_available');
    const storedEnvironments: EnvironmentRow[] = await db.select().from(environments);
    expect(
      storedEnvironments
        .map((environment: EnvironmentRow): string => environment.name)
        .sort((left: string, right: string): number => left.localeCompare(right)),
    ).toEqual(['staging']);
  });
  it('rolls back a service by queueing a new deployment for the previous successful artifact', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const authoredRun: AuthoredRunConfig = {
      command: 'pnpm start',
    };
    const expectedRun: ExpectedRunConfig = createExpectedRunConfig('pnpm start');

    const firstDeployPayload: DeployResponse = deployResponseSchema.parse(
      (
        await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
          descriptor: {
            name: 'smoke-web',
            services: {
              web: {
                path: '.',
                release: {
                  command: 'pnpm db:migrate',
                },
                run: authoredRun,
              },
            },
          },
          label: 'release 1',
        })
      ).json(),
    );
    const firstDeployment: DeploymentSummary = requireDeployResponseDeployment(firstDeployPayload);
    const firstClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    await completeQueuedDeployment(app, firstDeployment.id, firstClaimedDeployment.routeHost);

    const secondDeployPayload: DeployResponse = deployResponseSchema.parse(
      (
        await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
          descriptor: {
            name: 'smoke-web',
            services: {
              web: { accessMode: 'public', path: '.' },
            },
          },
        })
      ).json(),
    );
    const secondDeployment: DeploymentSummary = requireDeployResponseDeployment(secondDeployPayload);
    const secondClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    await completeQueuedDeployment(app, secondDeployment.id, secondClaimedDeployment.routeHost);

    const rollbackResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/deployments/rollback',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
      payload: {
        environmentName: 'production',
        projectName: 'smoke-web',
        serviceName: 'web',
      },
    });
    expect(rollbackResponse.statusCode).toBe(200);
    const rollbackPayload: DeployResponse = deployResponseSchema.parse(rollbackResponse.json());
    const rollbackDeployment: DeploymentSummary = requireDeployResponseDeployment(rollbackPayload);
    expect(rollbackDeployment.id).not.toBe(firstDeployment.id);
    expect(rollbackDeployment.label).toBe('release 1');
    const [rollbackAuditEvent] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'deployment.rolled_back'));
    expect(rollbackAuditEvent).toEqual(
      expect.objectContaining({
        actorEmail: 'admin@example.com',
        environmentId: rollbackPayload.environment.id,
        organizationId: installPayload.organization.id,
        projectId: rollbackPayload.project.id,
        status: 'succeeded',
        targetId: rollbackDeployment.id,
        targetType: 'deployment',
      }),
    );
    const storedArtifacts: StoredBuildArtifactRow[] = await db.select().from(buildArtifacts);
    expect(storedArtifacts).toHaveLength(2);

    const claimedRollbackDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    expect(claimedRollbackDeployment.artifact.id).toBe(firstClaimedDeployment.artifact.id);
    expect(claimedRollbackDeployment.artifact.imageRef).toBe('registry.example/app@sha256:image');
    expect(claimedRollbackDeployment.run).toEqual(expectedRun);
    await completeQueuedDeployment(app, rollbackDeployment.id, claimedRollbackDeployment.routeHost);
    const accessModeAuditEvents: (typeof auditEvents.$inferSelect)[] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'service.access_mode.changed'));
    expect(accessModeAuditEvents).toHaveLength(2);
    expect(accessModeAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorEmail: 'admin@example.com', status: 'succeeded', targetType: 'service' }),
      ]),
    );
    expect(accessModeAuditEvents[0]?.targetId).toBe(accessModeAuditEvents[1]?.targetId);
    expect(accessModeAuditEvents.map((event: typeof auditEvents.$inferSelect): string => event.metadataJson)).toEqual(
      expect.arrayContaining([
        JSON.stringify({ currentAccessMode: 'public', previousAccessMode: 'authenticated' }),
        JSON.stringify({ currentAccessMode: 'authenticated', previousAccessMode: 'public' }),
      ]),
    );

    const statusResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/status?projectName=smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(statusResponse.statusCode).toBe(200);
    const statusPayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(statusResponse.json());
    expect(requireSingleDeployment(statusPayload.activeDeployments).id).toBe(rollbackDeployment.id);
    expect(requireSingleDeployment(statusPayload.activeDeployments).label).toBe('release 1');
  });
  it('rolls back to an explicit deployment even when its artifact is still active in another environment', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const firstDeployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const firstDeployment: DeploymentSummary = requireDeployResponseDeployment(firstDeployPayload);
    const firstClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    await completeQueuedDeployment(app, firstDeployment.id, firstClaimedDeployment.routeHost);

    const promoteResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/deployments/promote',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
      payload: {
        projectName: 'smoke-web',
        sourceEnvironmentName: 'production',
        targetEnvironmentName: 'staging',
      },
    });
    expect(promoteResponse.statusCode).toBe(200);
    const promotedPayload: DeployResponse = deployResponseSchema.parse(promoteResponse.json());
    const promotedDeployment: DeploymentSummary = requireDeployResponseDeployment(promotedPayload);
    const claimedPromotedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    await completeQueuedDeployment(app, promotedDeployment.id, claimedPromotedDeployment.routeHost);

    const secondDeployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const secondDeployment: DeploymentSummary = requireDeployResponseDeployment(secondDeployPayload);
    const secondClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    await completeQueuedDeployment(app, secondDeployment.id, secondClaimedDeployment.routeHost);

    const rollbackResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/deployments/rollback',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
      payload: {
        environmentName: 'production',
        projectName: 'smoke-web',
        serviceName: 'web',
        targetDeploymentId: firstDeployment.id,
      },
    });
    expect(rollbackResponse.statusCode).toBe(200);
    const rollbackPayload: DeployResponse = deployResponseSchema.parse(rollbackResponse.json());
    const rollbackDeployment: DeploymentSummary = requireDeployResponseDeployment(rollbackPayload);
    expect(rollbackDeployment.id).not.toBe(firstDeployment.id);

    const claimedRollbackDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    expect(claimedRollbackDeployment.artifact.id).toBe(firstClaimedDeployment.artifact.id);
    await completeQueuedDeployment(app, rollbackDeployment.id, claimedRollbackDeployment.routeHost);

    const statusResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/status?projectName=smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(statusResponse.statusCode).toBe(200);
    const statusPayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(statusResponse.json());
    expect(requireSingleDeployment(statusPayload.activeDeployments).id).toBe(rollbackDeployment.id);
  });
  it('returns not found when explicit rollback targets belong to another organization', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const acmeFirstRun: CompletedDeployRunResult = await deployAndCompleteRun(
      installPayload.sessionToken,
      createMultiServiceDescriptor(),
      createMultiServiceRoutes(),
    );
    await deployAndCompleteRun(installPayload.sessionToken, createMultiServiceDescriptor(), createMultiServiceRoutes());

    const createOrganizationResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      payload: {
        name: 'Beta Dev',
        slug: 'beta-dev',
      },
    });
    expect(createOrganizationResponse.statusCode).toBe(200);
    await deployAndCompleteRun(
      installPayload.sessionToken,
      createMultiServiceDescriptor(),
      createMultiServiceRoutes(),
      undefined,
      'beta-dev',
    );
    await deployAndCompleteRun(
      installPayload.sessionToken,
      createMultiServiceDescriptor(),
      createMultiServiceRoutes(),
      undefined,
      'beta-dev',
    );

    const acmeDeployment: DeploymentSummary = requireDeploymentByServiceName(
      acmeFirstRun.deployPayload.deployments,
      'web',
    );
    const wrongDeploymentResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/deployments/rollback',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'beta-dev',
      },
      payload: {
        environmentName: 'production',
        projectName: 'smoke-multi-service',
        serviceName: 'web',
        targetDeploymentId: acmeDeployment.id,
      },
    });
    expect(wrongDeploymentResponse.statusCode).toBe(404);
    expect(errorResponseSchema.parse(wrongDeploymentResponse.json()).error.code).toBe('deployment_not_found');

    const wrongRunResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/deployments/rollback',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'beta-dev',
      },
      payload: {
        environmentName: 'production',
        projectName: 'smoke-multi-service',
        targetDeploymentRunId: acmeFirstRun.deployPayload.deploymentRunId,
      },
    });
    expect(wrongRunResponse.statusCode).toBe(404);
    expect(errorResponseSchema.parse(wrongRunResponse.json()).error.code).toBe('deployment_not_found');
  });
  it('requires a service when rolling back to a specific deployment in a multi-service project', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployPayload: DeployResponse = deployResponseSchema.parse(
      (
        await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
          descriptor: createMultiServiceDescriptor(),
          routes: createMultiServiceRoutes(),
        })
      ).json(),
    );
    const targetDeployment: DeploymentSummary = requireDeploymentByServiceName(deployPayload.deployments, 'web');

    const rollbackResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/deployments/rollback',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
      payload: {
        environmentName: 'production',
        projectName: 'smoke-multi-service',
        targetDeploymentId: targetDeployment.id,
      },
    });

    expect(rollbackResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(rollbackResponse.json()).error.code).toBe('rollback_service_required');
  });

  it('rolls back a multi-service project to a selected deployment run', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const firstRun: CompletedDeployRunResult = await deployAndCompleteRun(
      installPayload.sessionToken,
      createMultiServiceDescriptor(),
      createMultiServiceRoutes(),
    );
    await deployAndCompleteRun(installPayload.sessionToken, createMultiServiceDescriptor(), createMultiServiceRoutes());
    await deployAndCompleteRun(installPayload.sessionToken, createMultiServiceDescriptor(), createMultiServiceRoutes());

    const rollbackResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/deployments/rollback',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
      payload: {
        environmentName: 'production',
        projectName: 'smoke-multi-service',
        targetDeploymentRunId: firstRun.deployPayload.deploymentRunId,
      },
    });

    expect(rollbackResponse.statusCode).toBe(200);
    const rollbackPayload: DeployResponse = deployResponseSchema.parse(rollbackResponse.json());
    expect(
      rollbackPayload.deployments
        .map((deployment: DeploymentSummary): string => deployment.serviceName)
        .sort((left: string, right: string): number => left.localeCompare(right)),
    ).toEqual(['backoffice', 'web']);

    const claimedRollbackDeployments: WorkerClaimedDeployment[] = [
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
    ];
    const claimedRollbackWebDeployment: WorkerClaimedDeployment = requireClaimedDeploymentByServiceName(
      claimedRollbackDeployments,
      'web',
    );
    const claimedRollbackBackofficeDeployment: WorkerClaimedDeployment = requireClaimedDeploymentByServiceName(
      claimedRollbackDeployments,
      'backoffice',
    );

    expect(claimedRollbackWebDeployment.artifact.id).toBe(
      requireClaimedDeploymentByServiceName(firstRun.claimedDeployments, 'web').artifact.id,
    );
    expect(claimedRollbackBackofficeDeployment.artifact.id).toBe(
      requireClaimedDeploymentByServiceName(firstRun.claimedDeployments, 'backoffice').artifact.id,
    );

    await completeClaimedDeployment(
      app,
      claimedRollbackWebDeployment.deploymentId,
      claimedRollbackWebDeployment.routeHost,
    );
    await completeClaimedDeployment(
      app,
      claimedRollbackBackofficeDeployment.deploymentId,
      claimedRollbackBackofficeDeployment.routeHost,
    );

    const statusResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/status?projectName=smoke-multi-service',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });

    expect(statusResponse.statusCode).toBe(200);
    const statusPayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(statusResponse.json());
    expect(statusPayload.activeDeployments).toHaveLength(2);
    expect(requireDeploymentByServiceName(statusPayload.activeDeployments, 'web').id).toBe(
      claimedRollbackWebDeployment.deploymentId,
    );
    expect(requireDeploymentByServiceName(statusPayload.activeDeployments, 'backoffice').id).toBe(
      claimedRollbackBackofficeDeployment.deploymentId,
    );
  });

  it('rejects rollback to a deployment run that does not cover the current active service topology', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const firstRun: CompletedDeployRunResult = await deployAndCompleteRun(
      installPayload.sessionToken,
      createMultiServiceDescriptor(),
      createMultiServiceRoutes(),
    );
    await deployAndCompleteRun(
      installPayload.sessionToken,
      createExpandedMultiServiceDescriptor(),
      createMultiServiceRoutes(),
      await createExpandedMultiServiceSourceArchive(),
    );

    const rollbackResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/deployments/rollback',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
      payload: {
        environmentName: 'production',
        projectName: 'smoke-multi-service',
        targetDeploymentRunId: firstRun.deployPayload.deploymentRunId,
      },
    });

    expect(rollbackResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(rollbackResponse.json()).error.code).toBe('rollback_run_topology_mismatch');
  });

  it('rolls back all active services in a multi-service project when no service is specified', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const firstDeployPayload: DeployResponse = deployResponseSchema.parse(
      (
        await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
          descriptor: createMultiServiceDescriptor(),
          routes: createMultiServiceRoutes(),
        })
      ).json(),
    );
    expect(
      firstDeployPayload.deployments
        .map((deployment: DeploymentSummary): string => deployment.serviceName)
        .sort((left: string, right: string): number => left.localeCompare(right)),
    ).toEqual(['backoffice', 'web']);
    const firstClaimedDeployments: WorkerClaimedDeployment[] = [
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
    ];
    await completeClaimedDeployment(
      app,
      firstClaimedDeployments[0]!.deploymentId,
      firstClaimedDeployments[0]!.routeHost,
    );
    await completeClaimedDeployment(
      app,
      firstClaimedDeployments[1]!.deploymentId,
      firstClaimedDeployments[1]!.routeHost,
    );

    const secondDeployPayload: DeployResponse = deployResponseSchema.parse(
      (
        await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
          descriptor: createMultiServiceDescriptor(),
          routes: createMultiServiceRoutes(),
        })
      ).json(),
    );
    const secondClaimedDeployments: WorkerClaimedDeployment[] = [
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
    ];
    await completeClaimedDeployment(
      app,
      secondClaimedDeployments[0]!.deploymentId,
      secondClaimedDeployments[0]!.routeHost,
    );
    await completeClaimedDeployment(
      app,
      secondClaimedDeployments[1]!.deploymentId,
      secondClaimedDeployments[1]!.routeHost,
    );

    const rollbackResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/deployments/rollback',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
      payload: {
        environmentName: 'production',
        projectName: 'smoke-multi-service',
      },
    });

    expect(rollbackResponse.statusCode).toBe(200);
    const rollbackPayload: DeployResponse = deployResponseSchema.parse(rollbackResponse.json());
    expect(
      rollbackPayload.deployments
        .map((deployment: DeploymentSummary): string => deployment.serviceName)
        .sort((left: string, right: string): number => left.localeCompare(right)),
    ).toEqual(['backoffice', 'web']);

    const storedArtifacts: StoredBuildArtifactRow[] = await db.select().from(buildArtifacts);
    expect(storedArtifacts).toHaveLength(4);

    const claimedRollbackDeployments: WorkerClaimedDeployment[] = [
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
      requireClaimedDeployment(await claimNextQueuedDeployment(app)),
    ];
    const claimedRollbackWebDeployment: WorkerClaimedDeployment = requireClaimedDeploymentByServiceName(
      claimedRollbackDeployments,
      'web',
    );
    const claimedRollbackBackofficeDeployment: WorkerClaimedDeployment = requireClaimedDeploymentByServiceName(
      claimedRollbackDeployments,
      'backoffice',
    );

    expect(claimedRollbackWebDeployment.artifact.id).toBe(
      requireClaimedDeploymentByServiceName(firstClaimedDeployments, 'web').artifact.id,
    );
    expect(claimedRollbackBackofficeDeployment.artifact.id).toBe(
      requireClaimedDeploymentByServiceName(firstClaimedDeployments, 'backoffice').artifact.id,
    );

    await completeClaimedDeployment(
      app,
      claimedRollbackWebDeployment.deploymentId,
      claimedRollbackWebDeployment.routeHost,
    );
    await completeClaimedDeployment(
      app,
      claimedRollbackBackofficeDeployment.deploymentId,
      claimedRollbackBackofficeDeployment.routeHost,
    );

    const statusResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/status?projectName=smoke-multi-service',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });

    expect(statusResponse.statusCode).toBe(200);
    const statusPayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(statusResponse.json());
    expect(statusPayload.activeDeployments).toHaveLength(2);
    expect(requireDeploymentByServiceName(statusPayload.activeDeployments, 'web').id).toBe(
      claimedRollbackWebDeployment.deploymentId,
    );
    expect(requireDeploymentByServiceName(statusPayload.activeDeployments, 'backoffice').id).toBe(
      claimedRollbackBackofficeDeployment.deploymentId,
    );

    const inspectResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/inspect?projectName=smoke-multi-service',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(inspectResponse.statusCode).toBe(200);
    const inspectPayload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(inspectResponse.json());
    expect(requireDeploymentByServiceName(inspectPayload.deployments, 'web').routes).toEqual(
      createMultiServiceRoutes().routes,
    );
    expect(requireDeploymentByServiceName(inspectPayload.deployments, 'backoffice').routes).toEqual([]);

    expect(requireDeploymentByServiceName(rollbackPayload.deployments, 'web').id).not.toBe(
      requireDeploymentByServiceName(secondDeployPayload.deployments, 'web').id,
    );
    expect(requireDeploymentByServiceName(rollbackPayload.deployments, 'backoffice').id).not.toBe(
      requireDeploymentByServiceName(secondDeployPayload.deployments, 'backoffice').id,
    );
  });
});

async function deployAndCompleteRun(
  sessionToken: string,
  descriptor: CompartmentAuthoredDescriptor,
  routes: CompartmentRoutesFile,
  sourceArchive?: Buffer,
  organizationSlug: string = 'acme-dev',
): Promise<CompletedDeployRunResult> {
  const deployPayload: DeployResponse = deployResponseSchema.parse(
    (
      await injectDeployRequest(app, sessionToken, organizationSlug, {
        descriptor,
        routes,
        sourceArchive,
      })
    ).json(),
  );
  const claimedDeployments: WorkerClaimedDeployment[] = [];
  for (const serviceName of Object.keys(descriptor.services)) {
    void serviceName;
    claimedDeployments.push(requireClaimedDeployment(await claimNextQueuedDeployment(app)));
  }
  for (const claimedDeployment of claimedDeployments) {
    await completeClaimedDeployment(app, claimedDeployment.deploymentId, claimedDeployment.routeHost);
  }

  return {
    claimedDeployments,
    deployPayload,
  };
}

function createExpandedMultiServiceDescriptor(): CompartmentAuthoredDescriptor {
  const descriptor: CompartmentAuthoredDescriptor = createMultiServiceDescriptor();

  return {
    ...descriptor,
    services: {
      ...descriptor.services,
      admin: {
        path: './services/admin',
        readiness: {
          path: '/healthz',
          timeoutMs: 30000,
          type: 'http',
        },
      },
    },
  };
}

async function createExpandedMultiServiceSourceArchive(): Promise<Buffer> {
  return await createSourceArchive({
    'compartment.yml':
      'name: smoke-multi-service\nservices:\n  backoffice:\n    kind: api\n    path: ./services/backoffice\n  web:\n    path: ./services/web\n  admin:\n    path: ./services/admin\n',
    'services/admin/package.json': '{"name":"admin"}\n',
    'services/backoffice/package.json': '{"name":"backoffice"}\n',
    'services/web/package.json': '{"name":"web"}\n',
    'package.json': '{"name":"root"}\n',
  });
}
