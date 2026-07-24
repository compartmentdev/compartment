import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  buildArtifacts,
  deploymentCustomDomains,
  deploymentRoutes,
  deploymentRuns,
  deployments,
  environments,
  operations,
  organizations,
  principals,
  projects,
  projectServices,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import {
  findActiveCustomDeploymentRouteByHost,
  listActiveCustomDeploymentRoutes,
  listActiveCustomDeploymentRoutesForProjects,
} from '../src/queries/custom-deployment-routes.query';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

const { testDatabaseUrl } = readDatabaseTestMode();
const customDeploymentRoutesDatabaseUrl: string = deriveProcessScopedDatabaseUrl(
  testDatabaseUrl,
  'custom_deployment_routes_query',
);
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  caddyTlsMode: 'internal',
  customTlsDirectory: '/etc/compartment/tls',
  controlPlaneHost: 'compartment.localhost',
  databaseUrl: customDeploymentRoutesDatabaseUrl,
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9443,
  publicHttpPort: 9080,
  publicHttpsPort: 443,
  publicProtocol: 'http',
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  runtimeControlToken: 'test-runtime-control-token',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(customDeploymentRoutesDatabaseUrl);
const db: Database = createDatabase(pool);

describe('custom deployment routes db queries', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: customDeploymentRoutesDatabaseUrl,
    db,
    pool,
  });

  it('returns only active custom routes with valid ownership and routing state', async (): Promise<void> => {
    await createQueryTestScope();
    await insertActiveDeploymentRoute();
    await insertCustomDomain({
      host: 'failed.customer.example.com',
      id: 'cdom_failed',
      ownershipStatus: 'invalid',
      routingStatus: 'invalid',
    });
    await insertCustomDomain({
      host: 'pending.customer.example.com',
      id: 'cdom_pending',
      ownershipStatus: 'pending',
      routingStatus: 'pending',
    });
    await insertCustomDomain({
      host: 'valid.customer.example.com',
      id: 'cdom_valid',
      ownershipStatus: 'valid',
      routingStatus: 'valid',
      verifiedAt: new Date('2026-04-24T10:10:00.000Z'),
    });

    await expect(listActiveCustomDeploymentRoutes()).resolves.toEqual([
      expect.objectContaining({
        host: 'valid.customer.example.com',
        projectName: 'billing',
        serviceName: 'web',
        subdomain: 'billing',
      }),
    ]);
    await expect(findActiveCustomDeploymentRouteByHost('valid.customer.example.com')).resolves.toEqual(
      expect.objectContaining({
        host: 'valid.customer.example.com',
      }),
    );
    await expect(findActiveCustomDeploymentRouteByHost('pending.customer.example.com')).resolves.toBeUndefined();
    await expect(findActiveCustomDeploymentRouteByHost('failed.customer.example.com')).resolves.toBeUndefined();
  });

  it('lists active custom routes only for the requested projects', async (): Promise<void> => {
    await createQueryTestScope();
    await insertActiveDeploymentRoute();
    await insertProjectScope({
      environmentId: 'env_console_routes',
      projectId: 'prj_console_routes',
      projectName: 'console',
      serviceId: 'svc_console_routes',
      serviceName: 'web',
    });
    await insertActiveDeploymentRoute({
      deploymentId: 'dep_console_routes',
      environmentId: 'env_console_routes',
      projectId: 'prj_console_routes',
      projectName: 'console',
      routeId: 'route_console_routes',
      routeSubdomain: 'console',
      serviceId: 'svc_console_routes',
      serviceName: 'web',
    });
    await insertCustomDomain({
      host: 'billing.customer.example.com',
      id: 'cdom_billing_scoped',
      ownershipStatus: 'valid',
      routingStatus: 'valid',
      verifiedAt: new Date('2026-04-24T10:10:00.000Z'),
    });
    await insertCustomDomain({
      environmentId: 'env_console_routes',
      host: 'console.customer.example.com',
      id: 'cdom_console_scoped',
      ownershipStatus: 'valid',
      projectServiceId: 'svc_console_routes',
      routingStatus: 'valid',
      verifiedAt: new Date('2026-04-24T10:20:00.000Z'),
    });

    await expect(listActiveCustomDeploymentRoutesForProjects(['prj_custom_routes'])).resolves.toEqual([
      expect.objectContaining({
        host: 'billing.customer.example.com',
        projectId: 'prj_custom_routes',
        projectName: 'billing',
      }),
    ]);
  });
});

async function createQueryTestScope(): Promise<void> {
  await db.insert(principals).values({
    email: 'custom-routes@example.com',
    id: 'prn_custom_routes',
    type: 'user',
  });
  await db.insert(organizations).values({
    id: 'org_custom_routes',
    name: 'Custom Routes Org',
    slug: 'custom-routes-org',
  });
  await insertProjectScope({
    environmentId: 'env_custom_routes',
    projectId: 'prj_custom_routes',
    projectName: 'billing',
    serviceId: 'svc_custom_routes',
    serviceName: 'web',
  });
}

async function insertProjectScope(input: {
  environmentId: string;
  projectId: string;
  projectName: string;
  serviceId: string;
  serviceName: string;
}): Promise<void> {
  await db.insert(projects).values({
    id: input.projectId,
    name: input.projectName,
    organizationId: 'org_custom_routes',
    updatedAt: new Date('2026-04-24T09:00:00.000Z'),
  });
  await db.insert(projectServices).values({
    id: input.serviceId,
    kind: 'web',
    name: input.serviceName,
    path: '.',
    projectId: input.projectId,
    updatedAt: new Date('2026-04-24T09:00:00.000Z'),
  });
  await db.insert(environments).values({
    id: input.environmentId,
    name: 'production',
    projectId: input.projectId,
    updatedAt: new Date('2026-04-24T09:00:00.000Z'),
  });
}

async function insertActiveDeploymentRoute(input?: {
  deploymentId?: string | undefined;
  environmentId?: string | undefined;
  projectId?: string | undefined;
  projectName?: string | undefined;
  routeId?: string | undefined;
  routeSubdomain?: string | undefined;
  serviceId?: string | undefined;
  serviceName?: string | undefined;
}): Promise<void> {
  const deploymentId: string = input?.deploymentId ?? 'dep_custom_routes';
  const deploymentRunId: string = `drn_${deploymentId}`;
  const environmentId: string = input?.environmentId ?? 'env_custom_routes';
  const projectId: string = input?.projectId ?? 'prj_custom_routes';
  const projectName: string = input?.projectName ?? 'billing';
  const routeId: string = input?.routeId ?? 'route_custom_routes';
  const routeSubdomain: string = input?.routeSubdomain ?? 'billing';
  const serviceId: string = input?.serviceId ?? 'svc_custom_routes';
  const serviceName: string = input?.serviceName ?? 'web';

  await db.insert(buildArtifacts).values({
    createdByPrincipalId: 'prn_custom_routes',
    id: `artifact_${deploymentId}`,
    imageRef: 'ghcr.io/compartmentdev/compartment-node:1.0.0',
    imageRepository: 'ghcr.io/compartmentdev/compartment-node',
    projectId,
    projectServiceId: serviceId,
    resolvedBuildEnvJson: '{}',
    resolvedBuildJson: '{}',
    sourceDigest: 'sha256:custom-routes',
    updatedAt: new Date('2026-04-24T09:00:00.000Z'),
  });
  await db.insert(operations).values({
    actorPrincipalId: 'prn_custom_routes',
    id: `op_${deploymentId}`,
    status: 'completed',
    summary: `Deploy ${projectName} ${serviceName}`,
    targetId: deploymentId,
    targetType: 'deployment',
    type: 'deployment.create',
  });
  await db.insert(deploymentRuns).values({
    environmentId,
    id: deploymentRunId,
    label: null,
    triggerType: 'manual',
    updatedAt: new Date('2026-04-24T09:05:00.000Z'),
  });
  await db.insert(deployments).values({
    accessMode: 'authenticated',
    buildArtifactId: `artifact_${deploymentId}`,
    completedAt: new Date('2026-04-24T09:05:00.000Z'),
    deploymentRunId,
    environmentId,
    health: 'healthy',
    id: deploymentId,
    isActive: true,
    operationId: `op_${deploymentId}`,
    projectServiceId: serviceId,
    promotionStage: 'active',
    resolvedPortsJson: '[3000]',
    resolvedReadinessJson: '{}',
    resolvedRoutesJson: '[]',
    resolvedRunJson: '{}',
    status: 'ready',
    updatedAt: new Date('2026-04-24T09:05:00.000Z'),
  });
  await db.insert(deploymentRoutes).values({
    accessScopeId: 'org_custom_routes',
    accessScopeType: 'organization',
    deploymentId,
    id: routeId,
    subdomain: routeSubdomain,
    updatedAt: new Date('2026-04-24T09:05:00.000Z'),
  });
}

async function insertCustomDomain(input: {
  environmentId?: string | undefined;
  host: string;
  id: string;
  ownershipStatus: 'invalid' | 'pending' | 'valid';
  projectServiceId?: string | undefined;
  routingStatus: 'invalid' | 'pending' | 'valid';
  verifiedAt?: Date | undefined;
}): Promise<void> {
  await db.insert(deploymentCustomDomains).values({
    createdByPrincipalId: 'prn_custom_routes',
    environmentId: input.environmentId ?? 'env_custom_routes',
    host: input.host,
    id: input.id,
    ownershipStatus: input.ownershipStatus,
    projectServiceId: input.projectServiceId ?? 'svc_custom_routes',
    routingStatus: input.routingStatus,
    updatedAt: new Date('2026-04-24T09:10:00.000Z'),
    verificationTokenHash: `hash-${input.id}`,
    ...(input.verifiedAt === undefined ? {} : { verifiedAt: input.verifiedAt }),
  });
}
