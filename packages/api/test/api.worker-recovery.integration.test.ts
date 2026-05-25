import {
  deployResponseSchema,
  workerClaimNextDeploymentPathname,
  type DeploymentSummary,
  type DeployResponse,
  type InstallResponse,
  type WorkerClaimDeploymentResponse,
  type WorkerRecoverDeploymentsResponse,
  buildCompartmentArtifactImageRepository,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';

import { buildArtifacts, deployments, operations } from '../src/db/schema';

import {
  claimNextQueuedDeployment,
  injectDeployRequest,
  installCompartment,
  queueIntegrationNodeAgentResponse,
  recoverRunningDeployments,
  registerLocalNode,
  requireDeployResponseDeployment,
} from './api-integration.harness';
import type { StoredBuildArtifactRow, StoredDeploymentRow, StoredOperationRow } from './api.integration.types';
import {
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTlsDirectory,
  configureApiRuntimeWithPublicIngress,
  resetApiIntegrationTlsDirectory,
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
  testCustomTlsDirectory,
} = createApiIntegrationTestContext('api_integration_worker_recovery', 'api-integration-worker-recovery');
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration worker recovery', (): void => {
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
    await resetApiIntegrationTlsDirectory(testCustomTlsDirectory);
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(defaultApiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db);
    hasInitializedApiIntegrationRuntime = true;
  });
  afterAll(async (): Promise<void> => {
    await cleanupApiIntegrationTlsDirectory(testCustomTlsDirectory);
  });
  afterEach(async (): Promise<void> => {
    vi.unstubAllGlobals();
    if (!hasInitializedApiIntegrationRuntime) {
      return;
    }

    hasInitializedApiIntegrationRuntime = false;
    await cleanupApiIntegrationRuntime(app, systemApp, pool);
  });
  it('rejects internal deployment worker routes without the runtime control token', async (): Promise<void> => {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: workerClaimNextDeploymentPathname,
    });

    expect(response.statusCode).toBe(401);
  });
  it('finalizes orphaned running deployments as failed without replaying stale work', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);

    const firstDeployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const firstDeployment: DeploymentSummary = requireDeployResponseDeployment(firstDeployPayload);
    const firstClaimedPayload: WorkerClaimDeploymentResponse = await claimNextQueuedDeployment(app);
    expect(firstClaimedPayload.deployment?.deploymentId).toBe(firstDeployment.id);

    const secondDeployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const secondDeployment: DeploymentSummary = requireDeployResponseDeployment(secondDeployPayload);
    const secondClaimedPayload: WorkerClaimDeploymentResponse = await claimNextQueuedDeployment(app);
    expect(secondClaimedPayload.deployment?.deploymentId).toBe(secondDeployment.id);

    queueIntegrationNodeAgentResponse({ deployment: null });
    queueIntegrationNodeAgentResponse({ deployment: null });

    const recoveredPayload: WorkerRecoverDeploymentsResponse = await recoverRunningDeployments(app);
    expect(recoveredPayload.recoveredDeploymentCount).toBe(2);

    const firstRecoveredDeployment: StoredDeploymentRow | undefined = await db.query.deployments.findFirst({
      where: eq(deployments.id, firstDeployment.id),
    });
    expect(firstRecoveredDeployment?.status).toBe('failed');
    expect(firstRecoveredDeployment?.failureMessage).toContain('worker lost track');

    const secondRecoveredDeployment: StoredDeploymentRow | undefined = await db.query.deployments.findFirst({
      where: eq(deployments.id, secondDeployment.id),
    });
    expect(secondRecoveredDeployment?.status).toBe('failed');
    expect(secondRecoveredDeployment?.failureMessage).toContain('worker lost track');

    const firstRecoveredOperation: StoredOperationRow | undefined = await db.query.operations.findFirst({
      where: eq(operations.id, firstDeployment.operation.id),
    });
    expect(firstRecoveredOperation?.status).toBe('failed');

    const secondRecoveredOperation: StoredOperationRow | undefined = await db.query.operations.findFirst({
      where: eq(operations.id, secondDeployment.operation.id),
    });
    expect(secondRecoveredOperation?.status).toBe('failed');

    const reclaimedPayload: WorkerClaimDeploymentResponse = await claimNextQueuedDeployment(app);
    expect(reclaimedPayload.deployment).toBeNull();
  });
  it('reconciles orphaned running deployments that are already live on the node', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);

    const deployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    const claimedPayload: WorkerClaimDeploymentResponse = await claimNextQueuedDeployment(app);
    expect(claimedPayload.deployment?.deploymentId).toBe(deployment.id);

    const recoveredPayload: WorkerRecoverDeploymentsResponse = await recoverRunningDeployments(app);
    expect(recoveredPayload.recoveredDeploymentCount).toBe(1);

    const recoveredDeployment: StoredDeploymentRow | undefined = await db.query.deployments.findFirst({
      where: eq(deployments.id, deployment.id),
    });
    expect(recoveredDeployment?.status).toBe('succeeded');
    expect(recoveredDeployment?.isActive).toBe(true);
    expect(recoveredDeployment?.containerId).toBe('container_123');
    expect(recoveredDeployment?.upstreamPort).toBe(31000);

    const recoveredOperation: StoredOperationRow | undefined = await db.query.operations.findFirst({
      where: eq(operations.id, deployment.operation.id),
    });
    expect(recoveredOperation?.status).toBe('succeeded');

    const recoveredArtifact: StoredBuildArtifactRow | undefined = await db.query.buildArtifacts.findFirst({
      where: eq(buildArtifacts.id, recoveredDeployment?.buildArtifactId ?? ''),
    });
    expect(recoveredArtifact?.imageRepository).toBe(
      buildCompartmentArtifactImageRepository(
        recoveredArtifact?.projectId ?? '',
        recoveredArtifact?.projectServiceId ?? '',
      ),
    );
    expect(recoveredArtifact?.imageRef).toBe('sha256:image');
  });

  it('does not fail orphaned running deployments during pending-drain recovery passes', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);

    const deployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    const claimedPayload: WorkerClaimDeploymentResponse = await claimNextQueuedDeployment(app);
    expect(claimedPayload.deployment?.deploymentId).toBe(deployment.id);

    queueIntegrationNodeAgentResponse({ deployment: null });

    const recoveredPayload: WorkerRecoverDeploymentsResponse = await recoverRunningDeployments(app, 'pending-drain');
    expect(recoveredPayload.recoveredDeploymentCount).toBe(0);

    const storedDeployment: StoredDeploymentRow | undefined = await db.query.deployments.findFirst({
      where: eq(deployments.id, deployment.id),
    });
    expect(storedDeployment?.status).toBe('running');
    expect(storedDeployment?.completedAt).toBeNull();
    expect(storedDeployment?.failureMessage).toBeNull();
  });
});
