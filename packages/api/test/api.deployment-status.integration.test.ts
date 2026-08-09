import {
  compartmentDeploymentRunLogsPathname,
  compartmentDeploymentMetricsPathname,
  deploymentMetricsSnapshotSchema,
  deploymentInspectResponseSchema,
  deploymentListResponseSchema,
  deploymentRunLogsResponseSchema,
  deploymentLogsResponseSchema,
  deploymentStatusResponseSchema,
  deployResponseSchema,
  errorResponseSchema,
  type DeploymentLogLine,
  type DeploymentLogsResponse,
  type DeploymentMetricsSnapshot,
  type DeploymentInspectResponse,
  type DeploymentInspectTarget,
  type DeploymentListResponse,
  type DeploymentRunLogsResponse,
  type DeploymentRunStepSummary,
  type DeploymentStatusResponse,
  type DeploymentSummary,
  type DeployResponse,
  type InstallResponse,
  type ProductLogIngestEvent,
  type PodResourceMetric,
  type WorkerClaimDeploymentResponse,
  type WorkerAppendDeploymentEventRequest,
  type WorkerClaimedDeployment,
  type WorkerPublishPodMetricsRequest,
  compartmentCurrentOrganizationHeaderName,
  workerAppendDeploymentEventPathname,
} from '@compartment/contracts';
import { immutableKubeName } from '@compartment/utils';
import type { LightMyRequestResponse } from 'fastify';
import { rm, writeFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';

import { buildArtifacts, deployments, environments, projectServices, projects } from '../src/db/schema';
import { ingestDeploymentProductLogs } from '../src/services/deployment-product-logs.service';
import { persistDeploymentReconcileObservation } from '../src/queries/deployment-reconcile.query';
import { prepareDeploymentReconcile } from '../src/services/deployment-reconcile.service';
import { publishPodMetricsSnapshot } from '../src/services/pod-metrics-snapshot.service';

import {
  buildOrganizationAuthorizationHeaders,
  claimNextQueuedDeployment,
  fetchArtifactSourceArchive,
  completeClaimedDeployment,
  createSourceArchive,
  injectDeployRequest,
  installCompartment,
  requireClaimedDeployment,
  requireDeployResponseDeployment,
  requireSingleDeployment,
  setVariable,
} from './api-integration.harness';
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

interface RunningReplacementFixture {
  firstClaim: WorkerClaimedDeployment;
  firstDeployment: DeploymentSummary;
  installPayload: InstallResponse;
  replacement: DeploymentSummary;
  replacementClaim: WorkerClaimedDeployment;
}

interface DnsPromiseMocks {
  resolve4: Mock<ResolveDnsRecord>;
  resolve6: Mock<ResolveDnsRecord>;
  resolveCname: Mock<ResolveDnsRecord>;
  resolveTxt: Mock<ResolveTxtRecord>;
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
} = createApiIntegrationTestContext('api_integration_deployment_status', 'api-integration-deployment-status');
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration deployment status', (): void => {
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
  it('does not sync service metadata when build env validation fails for an existing target', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const initialDeployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: {
              path: './legacy-web',
            },
          },
        },
        sourceArchive: await createSourceArchive({
          'compartment.yml': 'name: smoke-web\nservices:\n  web:\n    path: ./legacy-web\n',
          'legacy-web/package.json': '{"name":"legacy-web"}\n',
        }),
      },
    );
    expect(initialDeployResponse.statusCode).toBe(200);
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
          'compartment.yml':
            'name: smoke-web\nservices:\n  web:\n    path: ./services/web\n    build:\n      strategy: railpack\n      env:\n        - DATABASE_URL\n',
          'services/web/package.json': '{"name":"web"}\n',
        }),
      },
    );

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_deploy_config');
    expect(await db.select().from(deployments)).toHaveLength(1);
    expect(await db.select().from(buildArtifacts)).toHaveLength(1);
    expect(await db.select().from(projects)).toHaveLength(1);
    expect(await db.select().from(environments)).toHaveLength(1);
    expect(await db.select().from(projectServices)).toEqual([
      expect.objectContaining({
        kind: 'web',
        name: 'web',
        path: './legacy-web',
      }),
    ]);
  });

  it('requires current organization context to read deployment status and logs', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const statusResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/status?projectName=smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
    });
    expect(statusResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(statusResponse.json()).error.code).toBe('missing_current_organization');

    const logsResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/logs?projectName=smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
    });
    expect(logsResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(logsResponse.json()).error.code).toBe('missing_current_organization');
  });
  it('falls back to a failed service deployment and returns its run trail', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    requireClaimedDeployment(await claimNextQueuedDeployment(app));
    await appendWorkerDeploymentEvent(app, {
      deploymentId: deployment.id,
      deploymentRunId: deployPayload.deploymentRunId,
      level: 'error',
      message: 'image build failed: Dockerfile compile error',
      status: 'failed',
      stepKey: 'building_image',
      stream: 'compartment',
    });
    await appendWorkerDeploymentEvent(app, {
      deploymentId: deployment.id,
      deploymentRunId: deployPayload.deploymentRunId,
      level: 'error',
      message: 'Dockerfile compile error',
      status: 'failed',
      stepKey: 'completed',
      stream: 'compartment',
    });
    const failedResponse: LightMyRequestResponse = await app.inject({
      headers: { authorization: 'Bearer test-runtime-control-token' },
      method: 'POST',
      payload: { deploymentId: deployment.id, message: 'Dockerfile compile error' },
      url: '/internal/deployments/fail',
    });
    expect(failedResponse.statusCode, failedResponse.body).toBe(200);
    await db.update(deployments).set({ failureMessage: null }).where(eq(deployments.id, deployment.id));
    const headers: Record<string, string> = buildOrganizationAuthorizationHeaders(
      installPayload.sessionToken,
      'acme-dev',
    );

    const logsResponse: LightMyRequestResponse = await app.inject({
      headers,
      method: 'GET',
      url: '/v1/deployments/logs?projectName=smoke-web&serviceName=web',
    });
    expect(logsResponse.statusCode, logsResponse.body).toBe(200);
    const logsPayload: DeploymentLogsResponse = deploymentLogsResponseSchema.parse(logsResponse.json());
    expect(requireSingleDeployment(logsPayload.deployments)).toMatchObject({
      id: deployment.id,
      status: 'failed',
    });
    expect(logsPayload.lines.map((line: DeploymentLogLine): string => line.message)).toContain(
      'image build failed: Dockerfile compile error',
    );

    const statusResponse: LightMyRequestResponse = await app.inject({
      headers,
      method: 'GET',
      url: '/v1/deployments/status?projectName=smoke-web&serviceName=web',
    });
    expect(statusResponse.statusCode, statusResponse.body).toBe(200);
    expect(
      requireSingleDeployment(deploymentStatusResponseSchema.parse(statusResponse.json()).deployments),
    ).toMatchObject({
      failureMessage: 'Dockerfile compile error',
      promotionStage: 'building_image',
    });
  });
  it('returns not found when a deployment id belongs to a different organization scope', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const acmeDeployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(acmeDeployResponse.statusCode).toBe(200);
    const acmeDeployment: DeploymentSummary = requireDeployResponseDeployment(
      deployResponseSchema.parse(acmeDeployResponse.json()),
    );
    const acmeDeploymentRunId: string = deployResponseSchema.parse(acmeDeployResponse.json()).deploymentRunId;

    const createOrganizationResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      method: 'POST',
      payload: {
        name: 'Beta Dev',
        slug: 'beta-dev',
      },
      url: '/v1/organizations',
    });
    expect(createOrganizationResponse.statusCode).toBe(200);
    expect((await injectDeployRequest(app, installPayload.sessionToken, 'beta-dev')).statusCode).toBe(200);

    const statusResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken, 'beta-dev'),
      method: 'GET',
      url: `/v1/deployments/status?projectName=smoke-web&deploymentId=${encodeURIComponent(acmeDeployment.id)}`,
    });

    expect(statusResponse.statusCode).toBe(404);
    expect(errorResponseSchema.parse(statusResponse.json()).error.code).toBe('deployment_not_found');

    const runLogsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken, 'beta-dev'),
      method: 'GET',
      url: `${compartmentDeploymentRunLogsPathname}?projectName=smoke-web&selector=run&deploymentRunId=${encodeURIComponent(acmeDeploymentRunId)}`,
    });
    expect(runLogsResponse.statusCode).toBe(404);
    expect(errorResponseSchema.parse(runLogsResponse.json()).error.code).toBe('deployment_not_found');
  });
  it('queues, claims, completes, and serves deployment status and logs for the default production environment', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        label: '  release=1;hotfix  ',
      },
    );
    expect(deployResponse.statusCode).toBe(200);
    const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    expect(deployPayload.environment.name).toBe('production');
    expect(deployment.label).toBe('release=1;hotfix');
    const claimedPayload: WorkerClaimDeploymentResponse = await claimNextQueuedDeployment(app);
    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(claimedPayload);
    expect(claimedDeployment.deploymentId).toBe(deployment.id);
    expect(claimedDeployment.artifact.sourceDigest).toBeTruthy();
    const sourceArchiveResponse: LightMyRequestResponse = await fetchArtifactSourceArchive(
      app,
      claimedDeployment.artifact.id,
    );
    expect(sourceArchiveResponse.statusCode).toBe(200);
    expect(sourceArchiveResponse.headers['content-type']).toContain('application/gzip');
    expect(sourceArchiveResponse.body.length).toBeGreaterThan(0);
    const eventTime: number = Date.now();
    await completeClaimedDeployment(app, deployment.id, claimedDeployment.routeHost, new Date(eventTime + 3_000));
    const productLogEvent: ProductLogIngestEvent = {
      containerName: immutableKubeName('app', deployment.id),
      message: 'boot complete',
      namespace: `cpt-${deployment.id}`,
      podName: `${immutableKubeName('app', deployment.id)}-abc`,
      podUid: '34343434-3434-4434-8434-343434343434',
      restartIdentity: '0',
      sourceFingerprint: 'd'.repeat(64),
      sourceOffset: 1,
      stream: 'stdout',
      timestamp: new Date(eventTime + 4_000).toISOString(),
    };
    await expect(ingestDeploymentProductLogs([productLogEvent])).resolves.toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
    });
    await appendWorkerDeploymentEvent(app, {
      deploymentId: deployment.id,
      deploymentRunId: deployPayload.deploymentRunId,
      level: 'info',
      message: 'build output hidden from deployment logs',
      stepKey: 'building_image',
      stream: 'stdout',
      timestamp: new Date(eventTime + 1_000).toISOString(),
    });
    await appendWorkerDeploymentEvent(app, {
      deploymentId: deployment.id,
      deploymentRunId: deployPayload.deploymentRunId,
      level: 'info',
      message: 'release output visible in deployment logs',
      stepKey: 'release',
      stream: 'stdout',
      timestamp: new Date(eventTime + 2_000).toISOString(),
    });
    const retainedArchiveResponse: LightMyRequestResponse = await fetchArtifactSourceArchive(
      app,
      claimedDeployment.artifact.id,
    );
    expect(retainedArchiveResponse.statusCode).toBe(200);
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
    expect(requireSingleDeployment(statusPayload.deployments).status).toBe('succeeded');
    expect(requireSingleDeployment(statusPayload.deployments).label).toBe('release=1;hotfix');
    expect(requireSingleDeployment(statusPayload.activeDeployments).routeUrl).toBe('http://smoke-web.localhost');
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
    expect(requireSingleDeployment(deploymentListPayload.deployments).label).toBe('release=1;hotfix');
    expect(requireSingleDeployment(deploymentListPayload.deployments).deploymentRunId).toBe(
      deployPayload.deploymentRunId,
    );
    const inspectResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/inspect?projectName=smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(inspectResponse.statusCode).toBe(200);
    const inspectPayload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(inspectResponse.json());
    expect(requireSingleDeployment(inspectPayload.deployments).label).toBe('release=1;hotfix');
    const logsResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/logs?projectName=smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(logsResponse.statusCode).toBe(200);
    const logsPayload: DeploymentLogsResponse = deploymentLogsResponseSchema.parse(logsResponse.json());
    expect(requireSingleDeployment(logsPayload.deployments).serviceName).toBe('web');
    expect(logsPayload.deployments).toHaveLength(1);
    const logMessages: string[] = logsPayload.lines.map((line: DeploymentLogLine): string => line.message);
    expect(logMessages).toContain('release output visible in deployment logs');
    expect(logMessages).toContain('boot complete');
    expect(logMessages).not.toContain('build output hidden from deployment logs');
    expect(
      logsPayload.lines.find(
        (line: DeploymentLogLine): boolean => line.message === 'release output visible in deployment logs',
      )?.stream,
    ).toBe('stdout');
    const latestRunLogsResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `${compartmentDeploymentRunLogsPathname}?projectName=smoke-web&selector=latest&tailLines=1`,
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(latestRunLogsResponse.statusCode).toBe(200);
    const latestRunLogsPayload: DeploymentRunLogsResponse = deploymentRunLogsResponseSchema.parse(
      latestRunLogsResponse.json(),
    );
    expect(latestRunLogsPayload.deployment.id).toBe(deployPayload.deploymentRunId);
    expect(latestRunLogsPayload.lines).toHaveLength(1);
    expect(latestRunLogsPayload.lines[0]?.stepKey).toBe('completed');
    const runLogsResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `${compartmentDeploymentRunLogsPathname}?projectName=smoke-web&selector=run&deploymentRunId=${deployPayload.deploymentRunId}&tailLines=1`,
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(runLogsResponse.statusCode).toBe(200);
    const runLogsPayload: DeploymentRunLogsResponse = deploymentRunLogsResponseSchema.parse(runLogsResponse.json());
    expect(runLogsPayload.deployment.id).toBe(deployPayload.deploymentRunId);
    expect(runLogsPayload.lines).toHaveLength(1);
    expect(runLogsPayload.lines[0]?.stepKey).toBe('completed');
    expect(runLogsPayload.steps.map((step: DeploymentRunStepSummary): string => step.stepKey)).toEqual(
      expect.arrayContaining(['queued', 'completed']),
    );
    const runLogsSinceResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `${compartmentDeploymentRunLogsPathname}?projectName=smoke-web&selector=run&deploymentRunId=${deployPayload.deploymentRunId}&since=${encodeURIComponent(runLogsPayload.lines[0]!.timestamp)}&tailLines=1`,
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(runLogsSinceResponse.statusCode).toBe(200);
    const runLogsSincePayload: DeploymentRunLogsResponse = deploymentRunLogsResponseSchema.parse(
      runLogsSinceResponse.json(),
    );
    expect(runLogsSincePayload.lines).toHaveLength(1);
    expect(runLogsSincePayload.lines[0]?.stepKey).toBe('completed');
    expect(runLogsSincePayload.steps.map((step: DeploymentRunStepSummary): string => step.stepKey)).toEqual(
      expect.arrayContaining(['queued', 'completed']),
    );
    vi.unstubAllGlobals();

    const secondDeployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(secondDeployResponse.statusCode).toBe(200);
    const secondDeployPayload: DeployResponse = deployResponseSchema.parse(secondDeployResponse.json());
    const secondDeployment: DeploymentSummary = requireDeployResponseDeployment(secondDeployPayload);

    const scopedStatusResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: `/v1/deployments/status?projectName=smoke-web&deploymentId=${secondDeployment.id}&serviceName=web`,
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(scopedStatusResponse.statusCode).toBe(200);
    const scopedStatusPayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(
      scopedStatusResponse.json(),
    );
    expect(requireSingleDeployment(scopedStatusPayload.deployments).id).toBe(secondDeployment.id);
    expect(requireSingleDeployment(scopedStatusPayload.activeDeployments).id).toBe(deployment.id);
  });
  it('does not project deleted Kubernetes runtime topology when inspecting a stopped deployment', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const firstDeployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    const firstDeployment: DeploymentSummary = requireDeployResponseDeployment(
      deployResponseSchema.parse(firstDeployResponse.json()),
    );
    const firstClaim: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    await completeClaimedDeployment(app, firstDeployment.id, firstClaim.routeHost);

    const secondDeployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    const secondDeployment: DeploymentSummary = requireDeployResponseDeployment(
      deployResponseSchema.parse(secondDeployResponse.json()),
    );
    const secondClaim: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    await completeClaimedDeployment(app, secondDeployment.id, secondClaim.routeHost);
    const inspectResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken, 'acme-dev'),
      method: 'GET',
      url: `/v1/deployments/inspect?projectName=smoke-web&deploymentId=${firstDeployment.id}`,
    });

    expect(inspectResponse.statusCode, inspectResponse.body).toBe(200);
    const inspectPayload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(inspectResponse.json());
    expect(requireSingleDeployment(inspectPayload.deployments).runtime).toBeNull();
  });
  it('returns runtime topology without a route host while a replacement is running', async (): Promise<void> => {
    const { installPayload, replacement, replacementClaim } = await prepareRunningReplacement();
    await prepareDeploymentReconcile({
      deploymentId: replacement.id,
      deploymentName: `app-${replacement.id}`,
      imageRef: 'registry.example/app@sha256:replacement',
      namespace: `cpt-${replacement.id}`,
      networkPolicyNames: [],
      routeHost: replacementClaim.routeHost,
      serviceName: 'app',
    });

    const inspectResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken, 'acme-dev'),
      method: 'GET',
      url: `/v1/deployments/inspect?projectName=smoke-web&deploymentId=${replacement.id}`,
    });

    expect(inspectResponse.statusCode, inspectResponse.body).toBe(200);
    const inspectPayload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(inspectResponse.json());
    expect(requireSingleDeployment(inspectPayload.deployments)).toMatchObject({
      id: replacement.id,
      routeHost: null,
      runtime: { routeHost: null },
      status: 'running',
    });
  });
  it('keeps active deployment metrics visible while a replacement is running', async (): Promise<void> => {
    const { firstDeployment, installPayload, replacement, replacementClaim } = await prepareRunningReplacement();
    const snapshot: WorkerPublishPodMetricsRequest = {
      observedAt: new Date().toISOString(),
      pods: [
        {
          cpuMillicores: 100,
          deploymentId: firstDeployment.id,
          kind: 'application',
          memoryBytes: 64 * 1024 * 1024,
          namespace: 'cpt-smoke-web',
          observedAt: new Date().toISOString(),
          podName: 'active-pod',
          podUid: '11111111-1111-4111-8111-111111111111',
        },
        {
          cpuMillicores: 200,
          deploymentId: replacement.id,
          kind: 'application',
          memoryBytes: 128 * 1024 * 1024,
          namespace: 'cpt-smoke-web',
          observedAt: new Date().toISOString(),
          podName: 'replacement-pod',
          podUid: '22222222-2222-4222-8222-222222222222',
        },
      ],
      state: 'available',
    };
    publishPodMetricsSnapshot(snapshot);

    const rolloutResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken, 'acme-dev'),
      method: 'GET',
      url: `${compartmentDeploymentMetricsPathname}?projectName=smoke-web`,
    });

    expect(rolloutResponse.statusCode, rolloutResponse.body).toBe(200);
    const rolloutMetrics: DeploymentMetricsSnapshot = deploymentMetricsSnapshotSchema.parse(rolloutResponse.json());
    expect(rolloutMetrics.pods.map((pod: PodResourceMetric): string => pod.deploymentId)).toEqual([
      firstDeployment.id,
      replacement.id,
    ]);

    await completeClaimedDeployment(app, replacement.id, replacementClaim.routeHost);
    const steadyResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken, 'acme-dev'),
      method: 'GET',
      url: `${compartmentDeploymentMetricsPathname}?projectName=smoke-web`,
    });

    expect(steadyResponse.statusCode, steadyResponse.body).toBe(200);
    const steadyMetrics: DeploymentMetricsSnapshot = deploymentMetricsSnapshotSchema.parse(steadyResponse.json());
    expect(steadyMetrics.pods.map((pod: PodResourceMetric): string => pod.deploymentId)).toEqual([replacement.id]);
  });
  it('returns the active deployment runtime after a failed replacement rolls back', async (): Promise<void> => {
    const { firstClaim, firstDeployment, installPayload, replacement, replacementClaim } =
      await prepareRunningReplacement();
    const observedAt: Date = new Date('2026-07-12T10:00:00.000Z');
    await prepareDeploymentReconcile({
      deploymentId: replacement.id,
      deploymentName: `app-${replacement.id}`,
      imageRef: 'registry.example/app@sha256:replacement',
      namespace: `cpt-${replacement.id}`,
      networkPolicyNames: [],
      routeHost: replacementClaim.routeHost,
      serviceName: 'app',
    });
    await persistDeploymentReconcileObservation({
      deploymentId: replacement.id,
      failureMessage: null,
      observation: 'pending',
      observedAt,
      revision: 0,
    });
    await persistDeploymentReconcileObservation({
      deploymentId: replacement.id,
      failureMessage: 'readiness failed',
      observation: 'failed',
      observedAt,
      revision: 1,
    });

    const inspectResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken, 'acme-dev'),
      method: 'GET',
      url: '/v1/deployments/inspect?projectName=smoke-web',
    });

    expect(inspectResponse.statusCode, inspectResponse.body).toBe(200);
    const inspectPayload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(inspectResponse.json());
    expect(requireSingleDeployment(inspectPayload.deployments)).toMatchObject({
      failureMessage: 'readiness failed',
      id: replacement.id,
      promotionStage: 'awaiting_readiness',
      runtime: { routeHost: null },
      status: 'failed',
    });
    const activeDeployment: DeploymentInspectTarget = requireSingleDeployment(inspectPayload.activeDeployments);
    expect(activeDeployment).toMatchObject({ id: firstDeployment.id, status: 'succeeded' });
    expect(activeDeployment.runtime).toMatchObject({ routeHost: firstClaim.routeHost });

    const redeployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    const redeployment: DeploymentSummary = requireDeployResponseDeployment(
      deployResponseSchema.parse(redeployResponse.json()),
    );
    const redeployClaim: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    await completeClaimedDeployment(app, redeployment.id, redeployClaim.routeHost);

    const statusResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken, 'acme-dev'),
      method: 'GET',
      url: `/v1/deployments/status?projectName=smoke-web&deploymentId=${redeployment.id}&serviceName=web`,
    });
    expect(statusResponse.statusCode, statusResponse.body).toBe(200);
    const statusPayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(statusResponse.json());
    expect(requireSingleDeployment(statusPayload.activeDeployments)).toMatchObject({
      id: redeployment.id,
      routeUrl: `http://${redeployClaim.routeHost}`,
    });
  });
  it('does not serve per-artifact archives for non-source-resolution deployments', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceArchive: Buffer = await createSourceArchive({
      'compartment.yml': 'name: smoke-web\nservices:\n  web: .\n',
      'package.json': '{"name":"smoke-web"}\n',
    });
    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        sourceArchive,
      },
    );
    const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    const claimedPayload: WorkerClaimDeploymentResponse = await claimNextQueuedDeployment(app);
    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(claimedPayload);
    const legacyArchivePath: string = `${defaultApiConfig.sourceArchiveDirectory}/${claimedDeployment.artifact.id}.tgz`;

    expect(claimedDeployment.deploymentId).toBe(deployment.id);

    await db
      .update(buildArtifacts)
      .set({
        sourceUploadId: null,
      })
      .where(eq(buildArtifacts.id, claimedDeployment.artifact.id));
    await writeFile(legacyArchivePath, sourceArchive);

    try {
      const sourceArchiveResponse: LightMyRequestResponse = await fetchArtifactSourceArchive(
        app,
        claimedDeployment.artifact.id,
      );

      expect(sourceArchiveResponse.statusCode).toBe(404);
      expect(sourceArchiveResponse.json()).toMatchObject({
        error: {
          code: 'source_archive_not_found',
        },
      });
    } finally {
      await rm(legacyArchivePath, { force: true });
    }
  });
});

async function prepareRunningReplacement(): Promise<RunningReplacementFixture> {
  const installPayload: InstallResponse = await installCompartment(app);
  const firstDeployResponse: LightMyRequestResponse = await injectDeployRequest(
    app,
    installPayload.sessionToken,
    'acme-dev',
  );
  const firstDeployment: DeploymentSummary = requireDeployResponseDeployment(
    deployResponseSchema.parse(firstDeployResponse.json()),
  );
  const firstClaim: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
  await completeClaimedDeployment(app, firstDeployment.id, firstClaim.routeHost);
  const replacementResponse: LightMyRequestResponse = await injectDeployRequest(
    app,
    installPayload.sessionToken,
    'acme-dev',
  );
  const replacement: DeploymentSummary = requireDeployResponseDeployment(
    deployResponseSchema.parse(replacementResponse.json()),
  );
  const replacementClaim: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
  return { firstClaim, firstDeployment, installPayload, replacement, replacementClaim };
}

async function appendWorkerDeploymentEvent(apiApp: ApiApp, payload: WorkerAppendDeploymentEventRequest): Promise<void> {
  const response: LightMyRequestResponse = await apiApp.inject({
    headers: {
      authorization: 'Bearer test-runtime-control-token',
    },
    method: 'POST',
    payload,
    url: workerAppendDeploymentEventPathname,
  });

  expect(response.statusCode, response.body).toBe(200);
}
