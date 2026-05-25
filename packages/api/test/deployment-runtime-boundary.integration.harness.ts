import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import {
  compartmentCurrentOrganizationHeaderName,
  deploymentInspectResponseSchema,
  deployResponseSchema,
  type DeploymentInspectResponse,
  type DeploymentInspectTarget,
  type DeploymentPromotionStage,
  type DeploymentSummary,
  type DeployResponse,
  type InstallResponse,
  type RuntimeDrainState,
  type RuntimePreviousDeployment,
  type WorkerClaimedDeployment,
  type WorkerCompleteDeploymentRequest,
  type WorkerUpdateDeploymentRuntimeRequest,
} from '@compartment/contracts';
import { expect, vi } from 'vitest';
import {
  deriveProcessScopedDatabaseUrl,
  ensureDatabaseExists,
  readDatabaseTestMode,
  resetDatabase,
  runCompartmentApiMigrations as runApiMigrations,
} from '../../test-support/src';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { deployments } from '../src/db/schema';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import {
  claimNextQueuedDeployment,
  completeQueuedDeployment,
  injectDeployRequest,
  requireClaimedDeployment,
  requireDeployResponseDeployment,
  requireSingleDeployment,
} from './api-integration.harness';

interface StoredDeploymentRuntimeStateRow {
  drainDeadlineAt: Date | null;
  drainingContainerId: string | null;
  drainingDeploymentId: string | null;
  drainingNodeId: string | null;
  promotionStage: DeploymentPromotionStage;
  upstreamHost: string | null;
  upstreamPort: number | null;
}

interface StoredDeploymentRuntimeStateQueryRow {
  drainDeadlineAt: Date | null;
  drainingContainerId: string | null;
  drainingDeploymentId: string | null;
  drainingNodeId: string | null;
  promotionStage: string;
  upstreamHost: string | null;
  upstreamPort: number | null;
}

const { testDatabaseUrl } = readDatabaseTestMode();
const runtimeBoundaryDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'api_runtime_boundary');
const apiConfig: ApiConfig = {
  bindHost: '127.0.0.1',
  baseDomain: 'localhost',
  caddyTlsMode: 'internal',
  customTlsDirectory: '/etc/compartment/tls',
  controlPlaneHost: 'console.localhost',
  databaseUrl: runtimeBoundaryDatabaseUrl,
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9444,
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
  sourceArchiveDirectory: join(tmpdir(), 'compartment-api-runtime-boundary-source-archives'),
  resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  runtimeDefaultUpstreamHost: '127.0.0.1',
  nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
  systemApiSocketPath: '/tmp/compartment/compartment-runtime-boundary-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
  runtimeControlToken: 'test-runtime-control-token',
};
const pool: Pool = createDatabasePool(runtimeBoundaryDatabaseUrl);
const db: Database = createDatabase(pool);
export const app: ApiApp = createApp({ config: apiConfig, pool });
export const drainDeadlineAt: string = '2026-03-24T10:00:05.000Z';

export async function ensureRuntimeBoundaryDatabase(): Promise<void> {
  await ensureDatabaseExists(runtimeBoundaryDatabaseUrl);
}

export async function resetRuntimeBoundaryDatabase(): Promise<void> {
  await resetDatabase(runtimeBoundaryDatabaseUrl);
  await runApiMigrations(runtimeBoundaryDatabaseUrl);
}

export async function closeRuntimeBoundaryApp(): Promise<void> {
  await app.close();
}

export async function deployAndActivateCurrentService(installPayload: InstallResponse): Promise<DeploymentSummary> {
  const response: LightMyRequestResponse = await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev');
  expect(response.statusCode).toBe(200);
  const deployRunPayload: DeployResponse = deployResponseSchema.parse(response.json());
  const deployment: DeploymentSummary = requireDeployResponseDeployment(deployRunPayload);
  const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));

  await completeQueuedDeployment(app, deployment.id, claimedDeployment.routeHost);
  return deployment;
}

export async function completeDeploymentForWorker(input: WorkerCompleteDeploymentRequest): Promise<void> {
  const response: LightMyRequestResponse = await app.inject({
    headers: {
      authorization: 'Bearer test-runtime-control-token',
    },
    method: 'POST',
    payload: input,
    url: '/internal/deployments/complete',
  });

  expect(response.statusCode).toBe(200);
}

export async function updateRuntimeStateForWorker(input: WorkerUpdateDeploymentRuntimeRequest): Promise<void> {
  const response: LightMyRequestResponse = await app.inject({
    headers: {
      authorization: 'Bearer test-runtime-control-token',
    },
    method: 'POST',
    payload: input,
    url: '/internal/deployments/runtime-state',
  });

  expect(response.statusCode).toBe(200);
}

export function buildDrainState(previousDeployment: RuntimePreviousDeployment): RuntimeDrainState {
  return {
    drainDeadlineAt,
    drainingContainerId: previousDeployment.containerId,
    drainingDeploymentId: previousDeployment.deploymentId,
    drainingNodeId: previousDeployment.nodeId,
  };
}

export function requirePreviousDeployment(claimedDeployment: WorkerClaimedDeployment): RuntimePreviousDeployment {
  if (claimedDeployment.previousDeployment === undefined) {
    throw new Error('Expected previous deployment in claimed worker payload.');
  }

  return claimedDeployment.previousDeployment;
}

export async function readStoredRuntimeState(deploymentId: string): Promise<StoredDeploymentRuntimeStateRow> {
  const rows: StoredDeploymentRuntimeStateQueryRow[] = await db
    .select({
      drainDeadlineAt: deployments.drainDeadlineAt,
      drainingContainerId: deployments.drainingContainerId,
      drainingDeploymentId: deployments.drainingDeploymentId,
      drainingNodeId: deployments.drainingNodeId,
      promotionStage: deployments.promotionStage,
      upstreamHost: deployments.upstreamHost,
      upstreamPort: deployments.upstreamPort,
    })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  const row: StoredDeploymentRuntimeStateQueryRow | undefined = rows[0];
  if (row === undefined) {
    throw new Error(`Expected deployment ${deploymentId}.`);
  }

  return {
    ...row,
    promotionStage: row.promotionStage as DeploymentPromotionStage,
  };
}

export async function readActiveDeploymentInspect(installPayload: InstallResponse): Promise<DeploymentInspectTarget> {
  const response: LightMyRequestResponse = await app.inject({
    headers: {
      authorization: `Bearer ${installPayload.sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
    },
    method: 'GET',
    url: '/v1/deployments/inspect?projectName=smoke-web',
  });
  expect(response.statusCode).toBe(200);
  const payload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(response.json());

  return requireSingleDeployment(payload.activeDeployments);
}

export function stubRuntimeInspectResponse(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(
      async (): Promise<Response> =>
        await Promise.resolve(
          new Response(
            JSON.stringify({
              deployment: {
                containerId: 'container_candidate_123',
                imageRef: 'sha256:image-next',
                routeHost: 'smoke-web.localhost',
                upstreamHost: '127.0.0.1',
                upstreamPort: 32001,
              },
            }),
            { status: 200 },
          ),
        ),
    ),
  );
}
