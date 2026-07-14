import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import type * as CompartmentSdk from '@compartment/sdk';
import {
  compartmentCurrentOrganizationHeaderName,
  deployResponseSchema,
  deploymentInspectResponseSchema,
  deploymentListResponseSchema,
  deploymentLogsResponseSchema,
  deploymentStatusResponseSchema,
  type DeployResponse,
  type DeploymentInspectTarget,
  type DeploymentListResponse,
  type DeploymentLogsResponse,
  type DeploymentReadSummary,
  type DeploymentInspectResponse,
  type DeploymentSummary,
  type DeploymentStatusResponse,
  type InstallResponse,
  type NodeTailLogsQuery,
  type WorkerClaimedDeployment,
  type NodeInspectDeploymentResponse,
  type NodeTailLogsResponse,
  type PromoteDeploymentRequest,
  type RollbackDeploymentRequest,
} from '@compartment/contracts';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { createOrganizationMemberSession as createOrganizationMemberSessionFixture } from './api-auth-session-test.fixtures';
import { useApiDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { deploymentKubeReferences, deployments } from '../src/db/schema';
import { upsertDeploymentKubeReference } from '../src/queries/deployment-kube-reference.query';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import {
  claimNextQueuedDeployment,
  completeClaimedDeployment,
  completeQueuedDeployment,
  injectDeployRequest,
  installCompartment,
  registerLocalNode,
  requireClaimedDeployment,
  requireDeployResponseDeployment,
} from './api-integration.harness';
import { expectJsonError } from './api-route-test.harness';

interface AppAccessEdgeServiceModule {
  invalidateEdgeAppAccessSessions: () => Promise<void>;
  synchronizeEdgeAppAccessState: () => Promise<void>;
}

interface CreateOrganizationMemberSessionOptions {
  active?: boolean;
}

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceModule => ({
    invalidateEdgeAppAccessSessions: async (): Promise<void> => await Promise.resolve(),
    synchronizeEdgeAppAccessState: async (): Promise<void> => await Promise.resolve(),
  }),
);

vi.mock('@compartment/sdk', async (): Promise<typeof CompartmentSdk> => {
  const actual: typeof CompartmentSdk = await vi.importActual('@compartment/sdk');

  return {
    ...actual,
    inspectNodeDeployment: async (): Promise<NodeInspectDeploymentResponse> =>
      await Promise.resolve({
        deployment: {
          containerId: 'container_123',
          imageRef: 'sha256:image',
          routeHost: 'smoke-web.localhost',
          upstreamHost: '127.0.0.1',
          upstreamPort: 31000,
        },
      }),
    tailNodeDeploymentLogs: async (
      _requester: CompartmentSdk.NodeRequester,
      query: NodeTailLogsQuery,
    ): Promise<NodeTailLogsResponse> =>
      await Promise.resolve({
        lines: [
          {
            deploymentId: query.deploymentId,
            environmentName: query.environmentName,
            message: 'runtime ok',
            serviceName: query.serviceName,
            stream: 'stdout',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
  };
});

const { testDatabaseUrl } = readDatabaseTestMode();
const deploymentAuthorizationDatabaseUrl: string = deriveProcessScopedDatabaseUrl(
  testDatabaseUrl,
  'api_deployment_authorization',
);
const apiConfig: ApiConfig = {
  bindHost: '127.0.0.1',
  baseDomain: 'localhost',
  caddyTlsMode: 'internal',
  customTlsDirectory: '/etc/compartment/tls',
  controlPlaneHost: 'console.localhost',
  databaseUrl: deploymentAuthorizationDatabaseUrl,
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9443,
  publicProtocol: 'http',
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  publicHttpPort: 80,
  publicHttpsPort: 443,
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: join(tmpdir(), 'compartment-api-deployment-authorization-source-archives'),
  resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  runtimeDefaultUpstreamHost: '127.0.0.1',
  nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
  systemApiSocketPath: '/tmp/compartment/compartment-deployment-authorization-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
  runtimeControlToken: 'test-runtime-control-token',
};
const pool: Pool = createDatabasePool(deploymentAuthorizationDatabaseUrl);
const db: Database = createDatabase(pool);
const app: ApiApp = createApp({ config: apiConfig, pool });

describe('deployment authorization integration', (): void => {
  useApiDatabaseTestHarness(deploymentAuthorizationDatabaseUrl);

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it('allows readonly members to read low-priv deployment routes but blocks inspect, promote, and rollback', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();
    await deployAndComplete(installPayload.sessionToken);
    const readonlySessionToken: string = await createOrganizationMemberSession(installPayload, 'readonly');

    const listResponse: LightMyRequestResponse = await injectDeploymentRequestWithSession(
      readonlySessionToken,
      'GET',
      '/v1/deployments?projectName=smoke-web',
    );
    expect(listResponse.statusCode).toBe(200);
    const listPayload: DeploymentListResponse = deploymentListResponseSchema.parse(listResponse.json());
    expectReadonlyDeploymentResponsePayload(listPayload, false);
    expect(listPayload.deployments).toHaveLength(1);

    const statusResponse: LightMyRequestResponse = await injectDeploymentRequestWithSession(
      readonlySessionToken,
      'GET',
      '/v1/deployments/status?projectName=smoke-web',
    );
    expect(statusResponse.statusCode).toBe(200);
    const statusPayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(statusResponse.json());
    expectReadonlyDeploymentResponsePayload(statusPayload, true);
    expect(statusPayload.deployments).toHaveLength(1);

    const inspectResponse: LightMyRequestResponse = await injectDeploymentRequestWithSession(
      readonlySessionToken,
      'GET',
      '/v1/deployments/inspect?projectName=smoke-web',
    );
    expect(inspectResponse.statusCode).toBe(200);
    const inspectPayload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(inspectResponse.json());
    expect(inspectPayload.deployments).toHaveLength(1);
    expect(inspectPayload.sensitiveTopologyVisible).toBe(false);
    expect(inspectPayload.deployments[0]?.containerId).toBeNull();
    expect(inspectPayload.deployments[0]?.upstreamHost).toBeNull();
    expect(inspectPayload.deployments[0]?.upstreamPort).toBeNull();
    expect(inspectPayload.deployments[0]?.runtime).toBeNull();

    const logsResponse: LightMyRequestResponse = await injectDeploymentRequestWithSession(
      readonlySessionToken,
      'GET',
      '/v1/deployments/logs?projectName=smoke-web',
    );
    expect(logsResponse.statusCode).toBe(200);
    const logsPayload: DeploymentLogsResponse = deploymentLogsResponseSchema.parse(logsResponse.json());
    expectReadonlyDeploymentResponsePayload(logsPayload, false);
    expect(logsPayload.deployments).toHaveLength(1);

    const promoteResponse: LightMyRequestResponse = await injectDeploymentRequestWithSession(
      readonlySessionToken,
      'POST',
      '/v1/deployments/promote',
      {
        projectName: 'smoke-web',
        sourceEnvironmentName: 'production',
        targetEnvironmentName: 'staging',
      },
    );
    expectJsonError(promoteResponse, 403, 'forbidden');

    const rollbackResponse: LightMyRequestResponse = await injectDeploymentRequestWithSession(
      readonlySessionToken,
      'POST',
      '/v1/deployments/rollback',
      {
        environmentName: 'production',
        projectName: 'smoke-web',
        serviceName: 'web',
      },
    );
    expectJsonError(rollbackResponse, 403, 'forbidden');
  });

  it('allows deployer members to promote and rollback deployments', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();
    await deployAndComplete(installPayload.sessionToken);
    await deployAndComplete(installPayload.sessionToken);
    const deployerSessionToken: string = await createOrganizationMemberSession(installPayload, 'deployer');

    const inspectResponse: LightMyRequestResponse = await injectDeploymentRequestWithSession(
      deployerSessionToken,
      'GET',
      '/v1/deployments/inspect?projectName=smoke-web',
    );
    expect(inspectResponse.statusCode).toBe(200);
    const inspectPayload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(inspectResponse.json());
    expect(inspectPayload.sensitiveTopologyVisible).toBe(true);
    expect(inspectPayload.deployments[0]?.upstreamHost).toBe('127.0.0.1');
    expect(inspectPayload.deployments[0]?.upstreamPort).toBe(31000);
    expect(inspectPayload.deployments[0]?.runtime?.upstreamHost).toBe('127.0.0.1');
    expect(inspectPayload.deployments[0]?.runtime?.upstreamPort).toBe(31000);
    expect(inspectPayload.deployments).toHaveLength(1);
    expectPrivilegedInspectDeployment(inspectPayload.activeDeployments[0]);

    const promoteResponse: LightMyRequestResponse = await injectDeploymentRequestWithSession(
      deployerSessionToken,
      'POST',
      '/v1/deployments/promote',
      {
        projectName: 'smoke-web',
        sourceEnvironmentName: 'production',
        targetEnvironmentName: 'staging',
      },
    );
    expect(promoteResponse.statusCode).toBe(200);
    const promotePayload: DeployResponse = deployResponseSchema.parse(promoteResponse.json());
    const claimedPromotedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
      await claimNextQueuedDeployment(app),
    );
    await completeClaimedDeployment(
      app,
      requireDeployResponseDeployment(promotePayload).id,
      claimedPromotedDeployment.routeHost,
    );

    const rollbackResponse: LightMyRequestResponse = await injectDeploymentRequestWithSession(
      deployerSessionToken,
      'POST',
      '/v1/deployments/rollback',
      {
        environmentName: 'production',
        projectName: 'smoke-web',
        serviceName: 'web',
      },
    );
    expect(rollbackResponse.statusCode).toBe(200);
    deployResponseSchema.parse(rollbackResponse.json());
  });

  it('projects active Kubernetes runtime details without a Docker container id', async (): Promise<void> => {
    const installPayload: InstallResponse = await installAndRegisterNode();
    const deployment: DeploymentSummary = await deployAndComplete(installPayload.sessionToken);
    await db.update(deployments).set({ containerId: null }).where(eq(deployments.id, deployment.id));
    await upsertDeploymentKubeReference({
      deploymentId: deployment.id,
      deploymentName: 'app-smoke-web',
      id: 'kref_inspect',
      namespace: 'cpt-smoke-web',
      networkPolicyNames: [],
      serviceName: 'app-smoke-web',
    });
    await db
      .update(deploymentKubeReferences)
      .set({ state: 'active' })
      .where(eq(deploymentKubeReferences.deploymentId, deployment.id));

    const inspectResponse: LightMyRequestResponse = await injectDeploymentRequestWithSession(
      installPayload.sessionToken,
      'GET',
      '/v1/deployments/inspect?projectName=smoke-web',
    );
    expect(inspectResponse.statusCode).toBe(200);
    const inspectPayload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(inspectResponse.json());
    expect(inspectPayload.activeDeployments[0]?.runtime).toMatchObject({
      containerId: null,
      runtimeKind: 'kubernetes',
      upstreamHost: 'app-smoke-web.cpt-smoke-web.svc',
      upstreamPort: 80,
    });
  });
});

async function installAndRegisterNode(): Promise<InstallResponse> {
  const installPayload: InstallResponse = await installCompartment(app);
  await registerLocalNode(app);
  return installPayload;
}

async function deployAndComplete(sessionToken: string, environmentName?: string): Promise<DeploymentSummary> {
  const deployResponse: LightMyRequestResponse = await injectDeployRequest(app, sessionToken, 'acme-dev', {
    ...(environmentName !== undefined ? { environmentName } : {}),
  });
  expect(deployResponse.statusCode).toBe(200);
  const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
  const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
  await completeQueuedDeployment(app, deployment.id);
  return deployment;
}

async function injectDeploymentRequestWithSession(
  sessionToken: string,
  method: 'GET' | 'POST',
  url: string,
  payload?: PromoteDeploymentRequest | RollbackDeploymentRequest,
): Promise<LightMyRequestResponse> {
  const request: {
    headers: Record<string, string>;
    method: 'GET' | 'POST';
    url: string;
  } = {
    headers: {
      authorization: `Bearer ${sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
    },
    method,
    url,
  };

  return await app.inject(payload !== undefined ? { ...request, payload } : request);
}

async function createOrganizationMemberSession(
  installPayload: InstallResponse,
  role: 'deployer' | 'readonly' | 'viewer',
  options: CreateOrganizationMemberSessionOptions = {},
): Promise<string> {
  return await createOrganizationMemberSessionFixture({
    db,
    email: `${role}@example.com`,
    organizationId: installPayload.organization.id,
    principalId: `prn_${role}`,
    role,
    sessionId: `ses_${role}`,
    sessionSecret: apiConfig.sessionSecret,
    sessionToken: `${role}-session-token`,
    ...(options.active !== undefined ? { active: options.active } : {}),
  });
}

type ReadonlyDeploymentResponse = DeploymentListResponse | DeploymentLogsResponse | DeploymentStatusResponse;

function expectReadonlyDeploymentResponsePayload(
  payload: ReadonlyDeploymentResponse,
  expectActiveDeployments: boolean,
): void {
  expect(payload.project).toEqual({ name: 'smoke-web' });
  expect(payload.environment).toEqual({ name: 'production' });
  expectLowPrivilegeDeployment(payload.deployments[0]);

  if (!expectActiveDeployments) {
    return;
  }

  expect('activeDeployments' in payload).toBe(true);
  if ('activeDeployments' in payload) {
    expectLowPrivilegeDeployment(payload.activeDeployments[0]);
  }
}

function expectLowPrivilegeDeployment(deployment: DeploymentReadSummary | undefined): void {
  expect(deployment).toBeDefined();
  expect(deployment).not.toHaveProperty('build');
  expect(deployment).not.toHaveProperty('containerId');
  expect(deployment).not.toHaveProperty('operation.id');
  expect(deployment).not.toHaveProperty('operation.targetId');
  expect(deployment).not.toHaveProperty('operation.targetType');
  expect(deployment).not.toHaveProperty('readiness');
  expect(deployment).not.toHaveProperty('run');
}

function expectPrivilegedInspectDeployment(deployment: DeploymentInspectTarget | undefined): void {
  expect(deployment).toBeDefined();
  expect(deployment?.containerId).toBe('container_123');
  expect(deployment?.routeHost).toBe('smoke-web.localhost');
  expect(deployment?.upstreamHost).toBe('127.0.0.1');
  expect(deployment?.upstreamPort).toBe(31000);
  expect(deployment?.runtime?.containerId).toBe('container_123');
  expect(deployment?.runtime?.imageRef).toBe('sha256:image');
  expect(deployment?.runtime?.runtimeKind).toBe('node');
  expect(deployment).toHaveProperty('drain');
}
