import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { and, eq, inArray } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import {
  type DeploymentInspectResponse,
  type DeploymentSummary,
  type DeploymentStatusResponse,
  type DeployResponse,
  type InstallResponse,
  type WorkerClaimedDeployment,
  type WorkerClaimDeploymentResponse,
  deployResponseSchema,
  compartmentCurrentOrganizationHeaderName,
  deploymentInspectResponseSchema,
  deploymentStatusResponseSchema,
} from '@compartment/contracts';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { deployments, organizations, projects } from '../src/db/schema';
import { recoverOrphanedDeploymentBuildClaims } from '../src/services/deployment-worker.service';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { useApiDatabaseTestHarness } from './api-db-test.harness';
import {
  claimNextQueuedDeployment,
  completeClaimedDeployment,
  injectDeployRequest,
  installCompartment,
  requireClaimedDeployment,
  requireDeployResponseDeployment,
} from './api-integration.harness';

interface IdentifiedRow {
  id: string;
}

interface AppAccessEdgeServiceModule {
  invalidateEdgeAppAccessSessions: () => Promise<void>;
  synchronizeEdgeAppAccessState: () => Promise<void>;
}

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceModule => ({
    invalidateEdgeAppAccessSessions: async (): Promise<void> => await Promise.resolve(),
    synchronizeEdgeAppAccessState: async (): Promise<void> => await Promise.resolve(),
  }),
);

const { testDatabaseUrl } = readDatabaseTestMode();
const runtimeMovementDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'api_runtime_claim_order');
const variablesMasterKey: Buffer = parseVariablesMasterKey('11'.repeat(32));
const deploymentRuntimeMovementTimeoutMs: number = 20_000;
const apiConfig: ApiConfig = {
  bindHost: '127.0.0.1',
  baseDomain: 'localhost',
  caddyTlsMode: 'internal',
  customTlsDirectory: '/etc/compartment/tls',
  controlPlaneHost: 'console.localhost',
  databaseUrl: runtimeMovementDatabaseUrl,
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
  sourceArchiveDirectory: join(tmpdir(), 'compartment-api-runtime-claim-order-source-archives'),
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  systemApiSocketPath: '/tmp/compartment/compartment-runtime-claim-order-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey,
  runtimeControlToken: 'test-runtime-control-token',
};
const pool: Pool = createDatabasePool(runtimeMovementDatabaseUrl);
const db: Database = createDatabase(pool);
const app: ApiApp = createApp({ config: apiConfig, pool });

describe('deployment runtime movement claim order integration', (): void => {
  useApiDatabaseTestHarness(runtimeMovementDatabaseUrl);

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it(
    'requeues a build claim that never reached the Kubernetes handoff',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      const deployResponse: LightMyRequestResponse = await injectDeployRequest(
        app,
        installPayload.sessionToken,
        'acme-dev',
      );
      expect(deployResponse.statusCode).toBe(200);
      const firstClaim: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));

      await expect(recoverOrphanedDeploymentBuildClaims()).resolves.toBe(1);

      const recoveredClaim: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
      expect(recoveredClaim.deploymentId).toBe(firstClaim.deploymentId);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'gives another organization the next serial claim after one organization was just served',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await createOrganization(installPayload, 'Beta Dev', 'beta-dev');

      await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload, { environmentName: 'staging' });
      await deployAndClaimCurrentEnvironment(installPayload, {
        environmentName: 'staging',
        organizationSlug: 'beta-dev',
      });

      await queuePromotion(installPayload);
      await queuePromotion(installPayload, {
        sourceEnvironmentName: 'production',
        targetEnvironmentName: 'preview',
      });
      await queuePromotion(installPayload, { organizationSlug: 'beta-dev' });

      const acmeProjectId: string = await findProjectIdForOrganization('smoke-web', 'acme-dev');
      const betaProjectId: string = await findProjectIdForOrganization('smoke-web', 'beta-dev');
      const firstClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );

      expect(readClaimedOrganizationSlug(firstClaimedDeployment, acmeProjectId, betaProjectId)).toBe('acme-dev');
      await completeClaimedDeployment(app, firstClaimedDeployment.deploymentId, firstClaimedDeployment.routeHost);

      const secondClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );

      expect(readClaimedOrganizationSlug(secondClaimedDeployment, acmeProjectId, betaProjectId)).toBe('beta-dev');
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'uses deployment id as the tie-breaker for equally old queued promotions inside one organization',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);

      await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload, { environmentName: 'staging' });
      const firstQueuedDeployment: DeploymentSummary = await queuePromotion(installPayload);
      const secondQueuedDeployment: DeploymentSummary = await queuePromotion(installPayload, {
        sourceEnvironmentName: 'production',
        targetEnvironmentName: 'preview',
      });

      const queuedDeploymentIds: string[] = [firstQueuedDeployment.id, secondQueuedDeployment.id];
      const tiedCreatedAt: Date = new Date('2026-04-27T10:00:00.000Z');

      expect(queuedDeploymentIds).toHaveLength(2);

      await db
        .update(deployments)
        .set({
          createdAt: tiedCreatedAt,
          updatedAt: tiedCreatedAt,
        })
        .where(inArray(deployments.id, queuedDeploymentIds));

      const claimedDeploymentIds: string[] = [
        requireClaimedDeployment(await claimNextQueuedDeployment(app)).deploymentId,
        requireClaimedDeployment(await claimNextQueuedDeployment(app)).deploymentId,
      ];

      expect(claimedDeploymentIds).toEqual(
        [...queuedDeploymentIds].sort((left: string, right: string): number => left.localeCompare(right)),
      );
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'skips locked queued promotions when concurrent worker claims race',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);

      await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload, { environmentName: 'staging' });
      const firstQueuedDeployment: DeploymentSummary = await queuePromotion(installPayload);
      const secondQueuedDeployment: DeploymentSummary = await queuePromotion(installPayload, {
        sourceEnvironmentName: 'production',
        targetEnvironmentName: 'preview',
      });

      const queuedDeploymentIds: string[] = [firstQueuedDeployment.id, secondQueuedDeployment.id];
      const [firstClaim, secondClaim]: [WorkerClaimDeploymentResponse, WorkerClaimDeploymentResponse] =
        await Promise.all([claimNextQueuedDeployment(app), claimNextQueuedDeployment(app)]);
      const claimedDeploymentIds: string[] = [
        requireClaimedDeployment(firstClaim).deploymentId,
        requireClaimedDeployment(secondClaim).deploymentId,
      ];

      expect(new Set(claimedDeploymentIds).size).toBe(2);
      expect(
        [...claimedDeploymentIds].sort((left: string, right: string): number => left.localeCompare(right)),
      ).toEqual([...queuedDeploymentIds].sort((left: string, right: string): number => left.localeCompare(right)));
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'reserves distinct route hosts across organizations before completion without exposing them publicly',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await createOrganization(installPayload, 'Beta Dev', 'beta-dev');

      const acmeDeployResponse: LightMyRequestResponse = await injectDeployRequest(
        app,
        installPayload.sessionToken,
        'acme-dev',
      );
      const betaDeployResponse: LightMyRequestResponse = await injectDeployRequest(
        app,
        installPayload.sessionToken,
        'beta-dev',
      );

      expect(acmeDeployResponse.statusCode).toBe(200);
      expect(betaDeployResponse.statusCode).toBe(200);

      const [firstClaim, secondClaim]: [WorkerClaimDeploymentResponse, WorkerClaimDeploymentResponse] =
        await Promise.all([claimNextQueuedDeployment(app), claimNextQueuedDeployment(app)]);
      const routeHosts: string[] = [
        requireClaimedDeployment(firstClaim).routeHost,
        requireClaimedDeployment(secondClaim).routeHost,
      ];

      expect(new Set(routeHosts).size).toBe(2);
      expect(routeHosts).toContain('smoke-web.localhost');
      expect(
        routeHosts.some((routeHost: string): boolean => /^smoke-web-[a-f0-9]{6}\.localhost$/u.test(routeHost)),
      ).toBe(true);

      await assertReservedRouteIsHiddenForOrganization(installPayload, 'acme-dev');
      await assertReservedRouteIsHiddenForOrganization(installPayload, 'beta-dev');
    },
    deploymentRuntimeMovementTimeoutMs,
  );
});

interface DeployAndClaimCurrentEnvironmentInput {
  environmentName?: string;
  label?: string;
  organizationSlug?: string;
}

interface InjectPromoteRequestInput {
  organizationSlug?: string;
  projectName?: string;
  serviceName?: string;
  sourceEnvironmentName?: string;
  targetEnvironmentName?: string;
}

async function deployAndClaimCurrentEnvironment(
  installPayload: InstallResponse,
  input: DeployAndClaimCurrentEnvironmentInput = {},
): Promise<WorkerClaimedDeployment> {
  const organizationSlug: string = input.organizationSlug ?? 'acme-dev';
  const deployResponse: LightMyRequestResponse = await injectDeployRequest(
    app,
    installPayload.sessionToken,
    organizationSlug,
    {
      ...(input.environmentName !== undefined ? { environmentName: input.environmentName } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
    },
  );
  expect(deployResponse.statusCode).toBe(200);
  const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
  const deploymentSummary: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
  const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));

  await completeClaimedDeployment(app, deploymentSummary.id, claimedDeployment.routeHost);
  return claimedDeployment;
}

async function createOrganization(installPayload: InstallResponse, name: string, slug: string): Promise<void> {
  const response: LightMyRequestResponse = await app.inject({
    method: 'POST',
    url: '/v1/organizations',
    headers: {
      authorization: `Bearer ${installPayload.sessionToken}`,
    },
    payload: {
      name,
      slug,
    },
  });
  expect(response.statusCode).toBe(200);
}

async function findProjectIdForOrganization(projectName: string, organizationSlug: string): Promise<string> {
  const rows: IdentifiedRow[] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(organizations, eq(projects.organizationId, organizations.id))
    .where(and(eq(projects.name, projectName), eq(organizations.slug, organizationSlug)))
    .limit(1);
  const projectRow: IdentifiedRow | undefined = rows[0];
  if (projectRow === undefined) {
    throw new Error(`Expected project "${projectName}" in organization "${organizationSlug}".`);
  }

  return projectRow.id;
}

async function queuePromotion(
  installPayload: InstallResponse,
  input: InjectPromoteRequestInput = {},
): Promise<DeploymentSummary> {
  const response: LightMyRequestResponse = await injectPromoteRequest(installPayload, input);
  expect(response.statusCode).toBe(200);
  const payload: DeployResponse = deployResponseSchema.parse(response.json());
  return requireDeployResponseDeployment(payload);
}

async function injectPromoteRequest(
  installPayload: InstallResponse,
  input: InjectPromoteRequestInput = {},
): Promise<LightMyRequestResponse> {
  return await app.inject({
    method: 'POST',
    url: '/v1/deployments/promote',
    headers: {
      authorization: `Bearer ${installPayload.sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: input.organizationSlug ?? 'acme-dev',
    },
    payload: {
      projectName: input.projectName ?? 'smoke-web',
      ...(input.serviceName !== undefined ? { serviceName: input.serviceName } : {}),
      sourceEnvironmentName: input.sourceEnvironmentName ?? 'staging',
      targetEnvironmentName: input.targetEnvironmentName ?? 'production',
    },
  });
}

function readClaimedOrganizationSlug(
  deployment: WorkerClaimedDeployment,
  acmeProjectId: string,
  betaProjectId: string,
): string {
  if (deployment.projectId === acmeProjectId) {
    return 'acme-dev';
  }
  if (deployment.projectId === betaProjectId) {
    return 'beta-dev';
  }

  throw new Error(`Unexpected claimed project "${deployment.projectId}".`);
}

async function assertReservedRouteIsHiddenForOrganization(
  installPayload: InstallResponse,
  organizationSlug: string,
): Promise<void> {
  const statusResponse: LightMyRequestResponse = await app.inject({
    method: 'GET',
    url: '/v1/deployments/status?projectName=smoke-web',
    headers: {
      authorization: `Bearer ${installPayload.sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: organizationSlug,
    },
  });
  expect(statusResponse.statusCode).toBe(200);
  const statusPayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(statusResponse.json());

  expect(statusPayload.deployments).toHaveLength(1);
  expect(statusPayload.deployments[0]?.routeUrl).toBeNull();

  const inspectResponse: LightMyRequestResponse = await app.inject({
    method: 'GET',
    url: '/v1/deployments/inspect?projectName=smoke-web',
    headers: {
      authorization: `Bearer ${installPayload.sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: organizationSlug,
    },
  });
  expect(inspectResponse.statusCode).toBe(200);
  const inspectPayload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(inspectResponse.json());

  expect(inspectPayload.deployments).toHaveLength(1);
  expect(inspectPayload.deployments[0]?.routeHost).toBeNull();
}
