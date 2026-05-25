import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import {
  type DeploymentSummary,
  type DeployResponse,
  type InstallResponse,
  type SetVariableRequest,
  type WorkerClaimedDeployment,
  type WorkerClaimDeploymentResponse,
  deployResponseSchema,
  compartmentCurrentOrganizationHeaderName,
  errorResponseSchema,
} from '@compartment/contracts';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  deploymentRunEvents,
  deploymentRuns,
  deployments,
  environmentVariableValues,
  environments,
  operations,
  organizations,
  projectServices,
  projects,
} from '../src/db/schema';
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
  createMultiServiceDescriptor,
  createMultiServiceRoutes,
  injectDeployRequest,
  installCompartment,
  registerLocalNode,
  requireClaimedDeployment,
  requireDeployResponseDeployment,
} from './api-integration.harness';
import { encryptVariableValueForStorageForTests, type TestEncryptedVariableValue } from './variables-test-crypto';

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
const runtimeMovementDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'api_runtime_movement');
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
  sourceArchiveDirectory: join(tmpdir(), 'compartment-api-runtime-movement-source-archives'),
  resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  runtimeDefaultUpstreamHost: '127.0.0.1',
  nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
  systemApiSocketPath: '/tmp/compartment/compartment-runtime-movement-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey,
  runtimeControlToken: 'test-runtime-control-token',
};
const pool: Pool = createDatabasePool(runtimeMovementDatabaseUrl);
const db: Database = createDatabase(pool);
const app: ApiApp = createApp({ config: apiConfig, pool });

describe('deployment runtime movement integration', (): void => {
  useApiDatabaseTestHarness(runtimeMovementDatabaseUrl);

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it(
    'promote resolves runtime variables from the current target environment',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      const sourceDeployment: WorkerClaimedDeployment = await deployAndClaimCurrentEnvironment(installPayload, {
        releaseCommand: 'pnpm db:migrate',
      });
      expect(sourceDeployment.release).toEqual({ command: 'pnpm db:migrate' });
      await deployAndClaimCurrentEnvironment(installPayload, { environmentName: 'staging' });
      const projectId: string = await findProjectId('smoke-web');
      const productionEnvironmentId: string = await findEnvironmentId(projectId, 'production');
      const stagingEnvironmentId: string = await findEnvironmentId(projectId, 'staging');

      await insertEnvironmentVariableValue(productionEnvironmentId, 'RUNTIME_MARKER', 'production-current');
      await insertEnvironmentVariableValue(stagingEnvironmentId, 'RUNTIME_MARKER', 'staging-current');

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
      deployResponseSchema.parse(promoteResponse.json());

      const claimedPromotedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );
      expect(claimedPromotedDeployment.runtimeEnv.RUNTIME_MARKER).toBe('production-current');
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'rollback resolves runtime variables from the current environment instead of the historical deployment snapshot',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      const firstDeployment: WorkerClaimedDeployment = await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload);
      const projectId: string = await findProjectId('smoke-web');
      const productionEnvironmentId: string = await findEnvironmentId(projectId, 'production');

      await insertEnvironmentVariableValue(productionEnvironmentId, 'RUNTIME_MARKER', 'production-current');

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
      deployResponseSchema.parse(rollbackResponse.json());

      const claimedRollbackDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );
      expect(claimedRollbackDeployment.runtimeEnv.RUNTIME_MARKER).toBe('production-current');
      expect(claimedRollbackDeployment.artifact.id).toBe(firstDeployment.artifact.id);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'injects sensitive variables into the claimed runtime without persisting them in deployment metadata',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await setVariable(installPayload, {
        keyName: 'DATABASE_URL',
        projectName: 'smoke-web',
        sensitivity: 'sensitive',
        value: 'postgres://sensitive-runtime',
      });

      const claimedDeployment: WorkerClaimedDeployment = await deployAndClaimCurrentEnvironment(installPayload);

      expect(claimedDeployment.runtimeEnv.DATABASE_URL).toBe('postgres://sensitive-runtime');
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'deduplicates concurrent identical promote requests for the same target service',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndClaimCurrentEnvironment(installPayload);
      const stagingDeployment: WorkerClaimedDeployment = await deployAndClaimCurrentEnvironment(installPayload, {
        environmentName: 'staging',
      });

      const responses: LightMyRequestResponse[] = await Promise.all([
        injectPromoteRequest(installPayload),
        injectPromoteRequest(installPayload),
        injectPromoteRequest(installPayload),
      ]);

      expect(responses.map((response: LightMyRequestResponse): number => response.statusCode)).toEqual([200, 200, 200]);
      const deploymentIds: string[] = responses.map(
        (response: LightMyRequestResponse): string =>
          requireDeployResponseDeployment(deployResponseSchema.parse(response.json())).id,
      );

      expect(new Set(deploymentIds).size).toBe(1);
      expect(await findMovementDeploymentsBySourceDeploymentId(stagingDeployment.deploymentId)).toHaveLength(1);
      expect((await findMovementDeploymentsBySourceDeploymentId(stagingDeployment.deploymentId))[0]?.id).toBe(
        deploymentIds[0],
      );
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'deduplicates concurrent identical rollback requests for the same target service',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      const firstDeployment: WorkerClaimedDeployment = await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload);

      const responses: LightMyRequestResponse[] = await Promise.all([
        injectRollbackRequest(installPayload),
        injectRollbackRequest(installPayload),
        injectRollbackRequest(installPayload),
      ]);

      expect(responses.map((response: LightMyRequestResponse): number => response.statusCode)).toEqual([200, 200, 200]);
      const deploymentIds: string[] = responses.map(
        (response: LightMyRequestResponse): string =>
          requireDeployResponseDeployment(deployResponseSchema.parse(response.json())).id,
      );

      expect(new Set(deploymentIds).size).toBe(1);
      expect(await findMovementDeploymentsBySourceDeploymentId(firstDeployment.deploymentId)).toHaveLength(1);
      expect((await findMovementDeploymentsBySourceDeploymentId(firstDeployment.deploymentId))[0]?.id).toBe(
        deploymentIds[0],
      );
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'deduplicates exact multi-service rollback retries in request order',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndCompleteMultiServiceEnvironment(installPayload, 'production');
      await deployAndCompleteMultiServiceEnvironment(installPayload, 'production');

      const firstRollbackResponse: LightMyRequestResponse = await injectRollbackRequest(installPayload, {
        projectName: 'smoke-multi-service',
        serviceName: null,
      });
      expect(firstRollbackResponse.statusCode).toBe(200);
      const firstRollbackPayload: DeployResponse = deployResponseSchema.parse(firstRollbackResponse.json());

      const duplicateRollbackResponse: LightMyRequestResponse = await injectRollbackRequest(installPayload, {
        projectName: 'smoke-multi-service',
        serviceName: null,
      });
      expect(duplicateRollbackResponse.statusCode).toBe(200);
      const duplicateRollbackPayload: DeployResponse = deployResponseSchema.parse(duplicateRollbackResponse.json());

      expect(
        firstRollbackPayload.deployments.map((deployment: DeploymentSummary): string => deployment.serviceName),
      ).toEqual(['backoffice', 'web']);
      expect(firstRollbackPayload.deployments.map((deployment: DeploymentSummary): string => deployment.id)).toEqual(
        duplicateRollbackPayload.deployments.map((deployment: DeploymentSummary): string => deployment.id),
      );
      expect(
        duplicateRollbackPayload.deployments.map((deployment: DeploymentSummary): string => deployment.serviceName),
      ).toEqual(['backoffice', 'web']);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'deduplicates explicit rollback retries while rejecting conflicting rollback targets for the same service',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload);

      const projectId: string = await findProjectId('smoke-web');
      const productionEnvironmentId: string = await findEnvironmentId(projectId, 'production');
      const webServiceId: string = await findProjectServiceId(projectId, 'web');
      const deploymentIds: string[] = await listDeploymentIdsForEnvironmentService(
        productionEnvironmentId,
        webServiceId,
      );
      const newerRollbackTargetId: string = deploymentIds[1]!;
      const olderRollbackTargetId: string = deploymentIds[2]!;

      const firstRollbackResponse: LightMyRequestResponse = await injectRollbackRequest(installPayload, {
        targetDeploymentId: newerRollbackTargetId,
      });
      expect(firstRollbackResponse.statusCode).toBe(200);
      const firstRollbackDeployment: DeploymentSummary = requireDeployResponseDeployment(
        deployResponseSchema.parse(firstRollbackResponse.json()),
      );

      const claimedRollbackDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );
      expect(claimedRollbackDeployment.deploymentId).toBe(firstRollbackDeployment.id);

      const duplicateAndConflictingResponses: LightMyRequestResponse[] = await Promise.all([
        injectRollbackRequest(installPayload, { targetDeploymentId: newerRollbackTargetId }),
        injectRollbackRequest(installPayload, { targetDeploymentId: olderRollbackTargetId }),
      ]);

      expect(readSortedStatusCodes(duplicateAndConflictingResponses)).toEqual([200, 409]);
      expect(readDeploymentTargetBusyErrors(duplicateAndConflictingResponses)).toHaveLength(1);

      const duplicateRollbackIds: string[] = duplicateAndConflictingResponses
        .filter((response: LightMyRequestResponse): boolean => response.statusCode === 200)
        .map(
          (response: LightMyRequestResponse): string =>
            requireDeployResponseDeployment(deployResponseSchema.parse(response.json())).id,
        );

      expect(duplicateRollbackIds).toEqual([firstRollbackDeployment.id]);
      expect(await findMovementDeploymentsBySourceDeploymentId(newerRollbackTargetId)).toHaveLength(1);
      expect(await listInFlightMovementDeploymentIds(productionEnvironmentId, webServiceId)).toEqual([
        firstRollbackDeployment.id,
      ]);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'deduplicates identical promote requests while the original movement is running',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndClaimCurrentEnvironment(installPayload);
      const stagingDeployment: WorkerClaimedDeployment = await deployAndClaimCurrentEnvironment(installPayload, {
        environmentName: 'staging',
      });

      const firstPromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload);
      expect(firstPromoteResponse.statusCode).toBe(200);
      const firstPromotePayload: DeployResponse = deployResponseSchema.parse(firstPromoteResponse.json());
      const firstPromotedDeployment: DeploymentSummary = requireDeployResponseDeployment(firstPromotePayload);
      const claimedPromotedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );
      expect(claimedPromotedDeployment.deploymentId).toBe(firstPromotedDeployment.id);

      const duplicateResponses: LightMyRequestResponse[] = await Promise.all([
        injectPromoteRequest(installPayload),
        injectPromoteRequest(installPayload),
      ]);

      expect(duplicateResponses.map((response: LightMyRequestResponse): number => response.statusCode)).toEqual([
        200, 200,
      ]);
      const deploymentIds: string[] = [
        firstPromotedDeployment.id,
        ...duplicateResponses.map(
          (response: LightMyRequestResponse): string =>
            requireDeployResponseDeployment(deployResponseSchema.parse(response.json())).id,
        ),
      ];

      expect(new Set(deploymentIds).size).toBe(1);
      expect(
        duplicateResponses.map(
          (response: LightMyRequestResponse): string => deployResponseSchema.parse(response.json()).deploymentRunId,
        ),
      ).toEqual([firstPromotePayload.deploymentRunId, firstPromotePayload.deploymentRunId]);
      expect(await findMovementDeploymentsBySourceDeploymentId(stagingDeployment.deploymentId)).toHaveLength(1);

      const projectId: string = await findProjectId('smoke-web');
      const productionEnvironmentId: string = await findEnvironmentId(projectId, 'production');

      expect(await countOperationsByTypeAndTargetId('deployment.promote', productionEnvironmentId)).toBe(1);
      expect(await countDeploymentRunsByTriggerTypeAndEnvironmentId('promote', productionEnvironmentId)).toBe(1);
      expect(await countQueuedDeploymentRunEvents(firstPromotePayload.deploymentRunId)).toBe(1);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'deduplicates identical rollback requests while the original movement is running',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      const firstDeployment: WorkerClaimedDeployment = await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload);

      const firstRollbackResponse: LightMyRequestResponse = await injectRollbackRequest(installPayload);
      expect(firstRollbackResponse.statusCode).toBe(200);
      const firstRollbackPayload: DeployResponse = deployResponseSchema.parse(firstRollbackResponse.json());
      const firstRollbackDeployment: DeploymentSummary = requireDeployResponseDeployment(firstRollbackPayload);
      const claimedRollbackDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );
      expect(claimedRollbackDeployment.deploymentId).toBe(firstRollbackDeployment.id);

      const duplicateResponses: LightMyRequestResponse[] = await Promise.all([
        injectRollbackRequest(installPayload),
        injectRollbackRequest(installPayload),
      ]);

      expect(duplicateResponses.map((response: LightMyRequestResponse): number => response.statusCode)).toEqual([
        200, 200,
      ]);
      const deploymentIds: string[] = [
        firstRollbackDeployment.id,
        ...duplicateResponses.map(
          (response: LightMyRequestResponse): string =>
            requireDeployResponseDeployment(deployResponseSchema.parse(response.json())).id,
        ),
      ];

      expect(new Set(deploymentIds).size).toBe(1);
      expect(
        duplicateResponses.map(
          (response: LightMyRequestResponse): string => deployResponseSchema.parse(response.json()).deploymentRunId,
        ),
      ).toEqual([firstRollbackPayload.deploymentRunId, firstRollbackPayload.deploymentRunId]);
      expect(await findMovementDeploymentsBySourceDeploymentId(firstDeployment.deploymentId)).toHaveLength(1);

      const projectId: string = await findProjectId('smoke-web');
      const productionEnvironmentId: string = await findEnvironmentId(projectId, 'production');

      expect(await countOperationsByTypeAndTargetId('deployment.rollback', productionEnvironmentId)).toBe(1);
      expect(await countDeploymentRunsByTriggerTypeAndEnvironmentId('rollback', productionEnvironmentId)).toBe(1);
      expect(await countQueuedDeploymentRunEvents(firstRollbackPayload.deploymentRunId)).toBe(1);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'rejects concurrent conflicting promote requests for the same target service',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload, { environmentName: 'staging' });
      await deployAndClaimCurrentEnvironment(installPayload, { environmentName: 'preview' });

      const responses: LightMyRequestResponse[] = await Promise.all([
        injectPromoteRequest(installPayload),
        injectPromoteRequest(installPayload, {
          sourceEnvironmentName: 'preview',
        }),
      ]);

      expect(readSortedStatusCodes(responses)).toEqual([200, 409]);
      expect(readDeploymentTargetBusyErrors(responses)).toHaveLength(1);

      const projectId: string = await findProjectId('smoke-web');
      const environmentId: string = await findEnvironmentId(projectId, 'production');
      const serviceId: string = await findProjectServiceId(projectId, 'web');

      expect(await listInFlightMovementDeploymentIds(environmentId, serviceId)).toHaveLength(1);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'rejects concurrent conflicting promote and rollback requests for the same target service',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload, { environmentName: 'staging' });

      const responses: LightMyRequestResponse[] = await Promise.all([
        injectPromoteRequest(installPayload),
        injectRollbackRequest(installPayload),
      ]);

      expect(readSortedStatusCodes(responses)).toEqual([200, 409]);
      expect(readDeploymentTargetBusyErrors(responses)).toHaveLength(1);

      const projectId: string = await findProjectId('smoke-web');
      const environmentId: string = await findEnvironmentId(projectId, 'production');
      const serviceId: string = await findProjectServiceId(projectId, 'web');

      expect(await listInFlightMovementDeploymentIds(environmentId, serviceId)).toHaveLength(1);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'rejects exact promote retries when an older conflicting in-flight movement still exists',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload, { environmentName: 'staging' });
      await deployAndClaimCurrentEnvironment(installPayload, { environmentName: 'preview' });

      const exactPromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload);
      expect(exactPromoteResponse.statusCode).toBe(200);
      const exactPromoteDeployment: DeploymentSummary = requireDeployResponseDeployment(
        deployResponseSchema.parse(exactPromoteResponse.json()),
      );
      const claimedExactPromoteDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );
      await completeClaimedDeployment(
        app,
        claimedExactPromoteDeployment.deploymentId,
        claimedExactPromoteDeployment.routeHost,
      );

      const conflictingPromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload, {
        sourceEnvironmentName: 'preview',
      });
      expect(conflictingPromoteResponse.statusCode).toBe(200);
      const conflictingPromoteDeployment: DeploymentSummary = requireDeployResponseDeployment(
        deployResponseSchema.parse(conflictingPromoteResponse.json()),
      );

      const exactPromoteCreatedAt: Date = await readDeploymentCreatedAt(exactPromoteDeployment.id);
      await setDeploymentCreatedAt(conflictingPromoteDeployment.id, new Date(exactPromoteCreatedAt.getTime() - 60_000));

      const retriedExactPromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload);
      expect(retriedExactPromoteResponse.statusCode).toBe(409);
      expect(errorResponseSchema.parse(retriedExactPromoteResponse.json()).error.code).toBe('deployment_target_busy');

      const projectId: string = await findProjectId('smoke-web');
      const productionEnvironmentId: string = await findEnvironmentId(projectId, 'production');
      const webServiceId: string = await findProjectServiceId(projectId, 'web');

      expect(await listInFlightMovementDeploymentIds(productionEnvironmentId, webServiceId)).toEqual([
        conflictingPromoteDeployment.id,
      ]);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'keeps multi-service movement atomic when one target service already has an in-flight movement',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndCompleteMultiServiceEnvironment(installPayload, 'production');
      await deployAndCompleteMultiServiceEnvironment(installPayload, 'staging');

      const firstPromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload, {
        projectName: 'smoke-multi-service',
        serviceName: 'web',
      });
      expect(firstPromoteResponse.statusCode).toBe(200);

      const conflictedPromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload, {
        projectName: 'smoke-multi-service',
      });
      expect(conflictedPromoteResponse.statusCode).toBe(409);
      expect(errorResponseSchema.parse(conflictedPromoteResponse.json()).error.code).toBe('deployment_target_busy');

      const projectId: string = await findProjectId('smoke-multi-service');
      const productionEnvironmentId: string = await findEnvironmentId(projectId, 'production');
      const webServiceId: string = await findProjectServiceId(projectId, 'web');
      const backofficeServiceId: string = await findProjectServiceId(projectId, 'backoffice');

      expect(await listInFlightMovementDeploymentIds(productionEnvironmentId, webServiceId)).toHaveLength(1);
      expect(await listInFlightMovementDeploymentIds(productionEnvironmentId, backofficeServiceId)).toEqual([]);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'deduplicates exact multi-service promote retries in request order',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndCompleteMultiServiceEnvironment(installPayload, 'production');
      await deployAndCompleteMultiServiceEnvironment(installPayload, 'staging');

      const firstPromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload, {
        projectName: 'smoke-multi-service',
      });
      expect(firstPromoteResponse.statusCode).toBe(200);
      const firstPromotePayload: DeployResponse = deployResponseSchema.parse(firstPromoteResponse.json());

      const duplicatePromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload, {
        projectName: 'smoke-multi-service',
      });
      expect(duplicatePromoteResponse.statusCode).toBe(200);
      const duplicatePromotePayload: DeployResponse = deployResponseSchema.parse(duplicatePromoteResponse.json());

      expect(
        firstPromotePayload.deployments.map((deployment: DeploymentSummary): string => deployment.serviceName),
      ).toEqual(['backoffice', 'web']);
      expect(firstPromotePayload.deployments.map((deployment: DeploymentSummary): string => deployment.id)).toEqual(
        duplicatePromotePayload.deployments.map((deployment: DeploymentSummary): string => deployment.id),
      );
      expect(
        duplicatePromotePayload.deployments.map((deployment: DeploymentSummary): string => deployment.serviceName),
      ).toEqual(['backoffice', 'web']);

      const projectId: string = await findProjectId('smoke-multi-service');
      const productionEnvironmentId: string = await findEnvironmentId(projectId, 'production');

      expect(await countOperationsByTypeAndTargetId('deployment.promote', productionEnvironmentId)).toBe(2);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'deduplicates multi-service promote retries after one service already completed',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndCompleteMultiServiceEnvironment(installPayload, 'production');
      await deployAndCompleteMultiServiceEnvironment(installPayload, 'staging');

      const firstPromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload, {
        projectName: 'smoke-multi-service',
      });
      expect(firstPromoteResponse.statusCode).toBe(200);
      const firstPromotePayload: DeployResponse = deployResponseSchema.parse(firstPromoteResponse.json());
      expect(
        firstPromotePayload.deployments.map((deployment: DeploymentSummary): string => deployment.serviceName),
      ).toEqual(['backoffice', 'web']);

      const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
      await completeClaimedDeployment(app, claimedDeployment.deploymentId, claimedDeployment.routeHost);

      const duplicatePromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload, {
        projectName: 'smoke-multi-service',
      });
      expect(duplicatePromoteResponse.statusCode).toBe(200);
      const duplicatePromotePayload: DeployResponse = deployResponseSchema.parse(duplicatePromoteResponse.json());

      expect(firstPromotePayload.deployments.map((deployment: DeploymentSummary): string => deployment.id)).toEqual(
        duplicatePromotePayload.deployments.map((deployment: DeploymentSummary): string => deployment.id),
      );
      expect(
        duplicatePromotePayload.deployments.map((deployment: DeploymentSummary): string => deployment.serviceName),
      ).toEqual(['backoffice', 'web']);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'rejects multi-service promote retries after one service failed',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndCompleteMultiServiceEnvironment(installPayload, 'production');
      await deployAndCompleteMultiServiceEnvironment(installPayload, 'staging');

      const firstPromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload, {
        projectName: 'smoke-multi-service',
      });
      expect(firstPromoteResponse.statusCode).toBe(200);

      const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
      await failClaimedDeployment(claimedDeployment.deploymentId);

      const duplicatePromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload, {
        projectName: 'smoke-multi-service',
      });
      expect(duplicatePromoteResponse.statusCode).toBe(409);
      expect(errorResponseSchema.parse(duplicatePromoteResponse.json()).error.code).toBe('deployment_target_busy');
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'rejects stale multi-service promote retries after a newer direct deployment on a completed target',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndCompleteMultiServiceEnvironment(installPayload, 'production');
      await deployAndCompleteMultiServiceEnvironment(installPayload, 'staging');

      const firstPromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload, {
        projectName: 'smoke-multi-service',
      });
      expect(firstPromoteResponse.statusCode).toBe(200);

      const claimedPromoteDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );
      await completeClaimedDeployment(app, claimedPromoteDeployment.deploymentId, claimedPromoteDeployment.routeHost);

      const directDeployResponse: LightMyRequestResponse = await injectDeployRequest(
        app,
        installPayload.sessionToken,
        'acme-dev',
        {
          descriptor: createMultiServiceDescriptor(),
          environmentName: 'production',
          routes: createMultiServiceRoutes(),
          serviceName: claimedPromoteDeployment.service.name,
        },
      );
      expect(directDeployResponse.statusCode).toBe(200);

      const duplicatePromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload, {
        projectName: 'smoke-multi-service',
      });
      expect(duplicatePromoteResponse.statusCode).toBe(409);
      expect(errorResponseSchema.parse(duplicatePromoteResponse.json()).error.code).toBe('deployment_target_busy');
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'allows a new promote after the previous movement completed',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndClaimCurrentEnvironment(installPayload);
      const stagingDeployment: WorkerClaimedDeployment = await deployAndClaimCurrentEnvironment(installPayload, {
        environmentName: 'staging',
      });

      const firstPromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload);
      expect(firstPromoteResponse.statusCode).toBe(200);
      const firstPromotedDeployment: DeploymentSummary = requireDeployResponseDeployment(
        deployResponseSchema.parse(firstPromoteResponse.json()),
      );
      const firstClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );
      await completeClaimedDeployment(app, firstPromotedDeployment.id, firstClaimedDeployment.routeHost);

      const secondPromoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload);
      expect(secondPromoteResponse.statusCode).toBe(200);
      const secondPromotedDeployment: DeploymentSummary = requireDeployResponseDeployment(
        deployResponseSchema.parse(secondPromoteResponse.json()),
      );

      expect(secondPromotedDeployment.id).not.toBe(firstPromotedDeployment.id);
      expect(await findMovementDeploymentsBySourceDeploymentId(stagingDeployment.deploymentId)).toHaveLength(2);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'does not persist movement provenance for project start deployments',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);
      await deployAndClaimCurrentEnvironment(installPayload);

      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => {
          return await Promise.resolve(
            new Response(JSON.stringify({ stoppedAt: '2026-04-27T10:00:00.000Z' }), { status: 200 }),
          );
        }),
      );

      const stopResponse: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/v1/projects/smoke-web/stop',
        headers: {
          authorization: `Bearer ${installPayload.sessionToken}`,
          [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
        },
        payload: {},
      });
      expect(stopResponse.statusCode).toBe(200);

      const startResponse: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/v1/projects/smoke-web/start',
        headers: {
          authorization: `Bearer ${installPayload.sessionToken}`,
          [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
        },
        payload: {},
      });
      expect(startResponse.statusCode).toBe(200);

      const startedDeployment: { id: string; movementSourceDeploymentId: string | null } | undefined = await db
        .select({
          id: deployments.id,
          movementSourceDeploymentId: deployments.movementSourceDeploymentId,
        })
        .from(deployments)
        .innerJoin(operations, eq(deployments.operationId, operations.id))
        .where(eq(operations.type, 'deployment.start'))
        .orderBy(desc(deployments.createdAt))
        .limit(1)
        .then(
          (
            rows: { id: string; movementSourceDeploymentId: string | null }[],
          ): { id: string; movementSourceDeploymentId: string | null } | undefined => rows[0],
        );

      expect(startedDeployment?.movementSourceDeploymentId).toBeNull();
      const claimedStartedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );
      expect(claimedStartedDeployment.release).toBeNull();
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'allows promote while a project start deployment is queued for the same target service',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);

      await deployAndClaimCurrentEnvironment(installPayload);
      await deployAndClaimCurrentEnvironment(installPayload, { environmentName: 'staging' });

      vi.stubGlobal(
        'fetch',
        vi.fn(async (): Promise<Response> => {
          return await Promise.resolve(
            new Response(JSON.stringify({ stoppedAt: '2026-04-27T10:00:00.000Z' }), { status: 200 }),
          );
        }),
      );

      const stopResponse: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/v1/projects/smoke-web/stop',
        headers: {
          authorization: `Bearer ${installPayload.sessionToken}`,
          [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
        },
        payload: {},
      });
      expect(stopResponse.statusCode).toBe(200);

      const startResponse: LightMyRequestResponse = await app.inject({
        method: 'POST',
        url: '/v1/projects/smoke-web/start',
        headers: {
          authorization: `Bearer ${installPayload.sessionToken}`,
          [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
        },
        payload: {},
      });
      expect(startResponse.statusCode).toBe(200);

      const promoteResponse: LightMyRequestResponse = await injectPromoteRequest(installPayload);
      expect(promoteResponse.statusCode).toBe(200);
      const promoteDeployment: DeploymentSummary = requireDeployResponseDeployment(
        deployResponseSchema.parse(promoteResponse.json()),
      );

      const projectId: string = await findProjectId('smoke-web');
      const productionEnvironmentId: string = await findEnvironmentId(projectId, 'production');
      const webServiceId: string = await findProjectServiceId(projectId, 'web');

      expect(await listInFlightMovementDeploymentIds(productionEnvironmentId, webServiceId)).toEqual([
        promoteDeployment.id,
      ]);
    },
    deploymentRuntimeMovementTimeoutMs,
  );

  it(
    'gives another organization a first-round claim when workers race on a shared queue',
    async (): Promise<void> => {
      const installPayload: InstallResponse = await installCompartment(app);
      await registerLocalNode(app);
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
      const [firstClaim, secondClaim]: [WorkerClaimDeploymentResponse, WorkerClaimDeploymentResponse] =
        await Promise.all([claimNextQueuedDeployment(app), claimNextQueuedDeployment(app)]);
      const firstRoundClaimedOrganizationSlugs: string[] = [
        readClaimedOrganizationSlug(requireClaimedDeployment(firstClaim), acmeProjectId, betaProjectId),
        readClaimedOrganizationSlug(requireClaimedDeployment(secondClaim), acmeProjectId, betaProjectId),
      ];
      expect(
        [...firstRoundClaimedOrganizationSlugs].sort((left: string, right: string): number =>
          left.localeCompare(right),
        ),
      ).toEqual(['acme-dev', 'beta-dev']);

      const thirdClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
        await claimNextQueuedDeployment(app),
      );
      expect(readClaimedOrganizationSlug(thirdClaimedDeployment, acmeProjectId, betaProjectId)).toBe('acme-dev');
    },
    deploymentRuntimeMovementTimeoutMs,
  );
});

interface DeployAndClaimCurrentEnvironmentInput {
  environmentName?: string;
  label?: string;
  organizationSlug?: string;
  releaseCommand?: string;
}

interface InjectPromoteRequestInput {
  organizationSlug?: string;
  projectName?: string;
  serviceName?: string;
  sourceEnvironmentName?: string;
  targetEnvironmentName?: string;
}

interface InjectRollbackRequestInput {
  environmentName?: string;
  organizationSlug?: string;
  projectName?: string;
  serviceName?: string | null;
  targetDeploymentId?: string;
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
      ...(input.releaseCommand !== undefined
        ? {
            descriptor: {
              name: 'smoke-web',
              services: {
                web: {
                  path: '.',
                  release: {
                    command: input.releaseCommand,
                  },
                },
              },
            },
          }
        : {}),
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

async function findProjectId(projectName: string): Promise<string> {
  const rows: IdentifiedRow[] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.name, projectName))
    .limit(1);
  const projectRow: IdentifiedRow | undefined = rows[0];
  if (projectRow === undefined) {
    throw new Error(`Expected project "${projectName}".`);
  }

  return projectRow.id;
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

async function findEnvironmentId(projectId: string, environmentName: string): Promise<string> {
  const rows: IdentifiedRow[] = await db
    .select({ id: environments.id })
    .from(environments)
    .where(and(eq(environments.projectId, projectId), eq(environments.name, environmentName)))
    .limit(1);
  const environmentRow: IdentifiedRow | undefined = rows[0];
  if (environmentRow === undefined) {
    throw new Error(`Expected environment "${environmentName}".`);
  }

  return environmentRow.id;
}

async function findProjectServiceId(projectId: string, serviceName: string): Promise<string> {
  const rows: IdentifiedRow[] = await db
    .select({ id: projectServices.id })
    .from(projectServices)
    .where(and(eq(projectServices.projectId, projectId), eq(projectServices.name, serviceName)))
    .limit(1);
  const serviceRow: IdentifiedRow | undefined = rows[0];
  if (serviceRow === undefined) {
    throw new Error(`Expected service "${serviceName}".`);
  }

  return serviceRow.id;
}

async function insertEnvironmentVariableValue(
  environmentId: string,
  keyName: string,
  valuePlaintext: string,
): Promise<void> {
  const encryptedValue: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
    valuePlaintext,
    variablesMasterKey,
  );

  await db.insert(environmentVariableValues).values({
    createdByPrincipalId: null,
    encryptionKeyId: encryptedValue.encryptionKeyId,
    environmentId,
    id: `${environmentId}:*:${keyName}`,
    keyName,
    projectServiceId: null,
    sensitivity: 'plain',
    updatedByPrincipalId: null,
    valueCiphertext: encryptedValue.valueCiphertext,
    valueFingerprint: encryptedValue.valueFingerprint,
  });
}

async function setVariable(installPayload: InstallResponse, payload: SetVariableRequest): Promise<void> {
  const response: LightMyRequestResponse = await app.inject({
    method: 'POST',
    url: '/v1/variables',
    headers: {
      authorization: `Bearer ${installPayload.sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
    },
    payload,
  });
  expect(response.statusCode).toBe(200);
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

async function injectRollbackRequest(
  installPayload: InstallResponse,
  input: InjectRollbackRequestInput = {},
): Promise<LightMyRequestResponse> {
  const servicePayload: { serviceName?: string } =
    input.serviceName === null ? {} : { serviceName: input.serviceName ?? 'web' };

  return await app.inject({
    method: 'POST',
    url: '/v1/deployments/rollback',
    headers: {
      authorization: `Bearer ${installPayload.sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: input.organizationSlug ?? 'acme-dev',
    },
    payload: {
      environmentName: input.environmentName ?? 'production',
      projectName: input.projectName ?? 'smoke-web',
      ...servicePayload,
      ...(input.targetDeploymentId !== undefined ? { targetDeploymentId: input.targetDeploymentId } : {}),
    },
  });
}

async function deployAndCompleteMultiServiceEnvironment(
  installPayload: InstallResponse,
  environmentName: string,
): Promise<void> {
  const deployResponse: LightMyRequestResponse = await injectDeployRequest(
    app,
    installPayload.sessionToken,
    'acme-dev',
    {
      descriptor: createMultiServiceDescriptor(),
      environmentName,
      routes: createMultiServiceRoutes(),
    },
  );
  expect(deployResponse.statusCode).toBe(200);
  deployResponseSchema.parse(deployResponse.json());

  const firstClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
    await claimNextQueuedDeployment(app),
  );
  const secondClaimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(
    await claimNextQueuedDeployment(app),
  );

  await completeClaimedDeployment(app, firstClaimedDeployment.deploymentId, firstClaimedDeployment.routeHost);
  await completeClaimedDeployment(app, secondClaimedDeployment.deploymentId, secondClaimedDeployment.routeHost);
}

async function findMovementDeploymentsBySourceDeploymentId(sourceDeploymentId: string): Promise<{ id: string }[]> {
  return await db
    .select({ id: deployments.id })
    .from(deployments)
    .where(eq(deployments.movementSourceDeploymentId, sourceDeploymentId))
    .orderBy(desc(deployments.createdAt));
}

async function listInFlightMovementDeploymentIds(environmentId: string, projectServiceId: string): Promise<string[]> {
  const rows: IdentifiedRow[] = await db
    .select({ id: deployments.id })
    .from(deployments)
    .innerJoin(operations, eq(deployments.operationId, operations.id))
    .where(
      and(
        eq(deployments.environmentId, environmentId),
        eq(deployments.projectServiceId, projectServiceId),
        inArray(deployments.status, ['queued', 'running']),
        inArray(operations.type, ['deployment.promote', 'deployment.rollback']),
      ),
    )
    .orderBy(desc(deployments.createdAt));

  return rows.map((row: IdentifiedRow): string => row.id);
}

async function countOperationsByTypeAndTargetId(operationType: string, targetId: string): Promise<number> {
  const rows: IdentifiedRow[] = await db
    .select({ id: operations.id })
    .from(operations)
    .where(and(eq(operations.type, operationType), eq(operations.targetId, targetId)));

  return rows.length;
}

async function countDeploymentRunsByTriggerTypeAndEnvironmentId(
  triggerType: 'promote' | 'rollback',
  environmentId: string,
): Promise<number> {
  const rows: IdentifiedRow[] = await db
    .select({ id: deploymentRuns.id })
    .from(deploymentRuns)
    .where(and(eq(deploymentRuns.environmentId, environmentId), eq(deploymentRuns.triggerType, triggerType)));

  return rows.length;
}

async function countQueuedDeploymentRunEvents(deploymentRunId: string): Promise<number> {
  const rows: IdentifiedRow[] = await db
    .select({ id: deploymentRunEvents.id })
    .from(deploymentRunEvents)
    .where(and(eq(deploymentRunEvents.deploymentRunId, deploymentRunId), eq(deploymentRunEvents.stepKey, 'queued')));

  return rows.length;
}

async function readDeploymentCreatedAt(deploymentId: string): Promise<Date> {
  const row: { createdAt: Date } | undefined = await db
    .select({ createdAt: deployments.createdAt })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1)
    .then((rows: { createdAt: Date }[]): { createdAt: Date } | undefined => rows[0]);

  if (row === undefined) {
    throw new Error(`Expected deployment "${deploymentId}" to exist.`);
  }

  return row.createdAt;
}

async function failClaimedDeployment(deploymentId: string): Promise<void> {
  const failedResponse: LightMyRequestResponse = await app.inject({
    headers: {
      authorization: 'Bearer test-runtime-control-token',
    },
    method: 'POST',
    payload: {
      deploymentId,
      message: 'movement deployment failed',
    },
    url: '/internal/deployments/fail',
  });
  expect(failedResponse.statusCode).toBe(200);
}

async function setDeploymentCreatedAt(deploymentId: string, createdAt: Date): Promise<void> {
  await db
    .update(deployments)
    .set({
      createdAt,
      updatedAt: createdAt,
    })
    .where(eq(deployments.id, deploymentId));
}

async function listDeploymentIdsForEnvironmentService(
  environmentId: string,
  projectServiceId: string,
): Promise<string[]> {
  const rows: IdentifiedRow[] = await db
    .select({ id: deployments.id })
    .from(deployments)
    .where(and(eq(deployments.environmentId, environmentId), eq(deployments.projectServiceId, projectServiceId)))
    .orderBy(desc(deployments.createdAt), desc(deployments.id));

  return rows.map((row: IdentifiedRow): string => row.id);
}

function readSortedStatusCodes(responses: LightMyRequestResponse[]): number[] {
  return responses
    .map((response: LightMyRequestResponse): number => response.statusCode)
    .sort((left: number, right: number): number => left - right);
}

function readDeploymentTargetBusyErrors(
  responses: LightMyRequestResponse[],
): { error: { code: string; message: string } }[] {
  return responses
    .filter((response: LightMyRequestResponse): boolean => response.statusCode === 409)
    .map((response: LightMyRequestResponse): { error: { code: string; message: string } } =>
      errorResponseSchema.parse(response.json()),
    )
    .filter(
      (response: { error: { code: string; message: string } }): boolean =>
        response.error.code === 'deployment_target_busy',
    );
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
