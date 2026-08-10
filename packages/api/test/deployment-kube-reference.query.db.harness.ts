import type { Pool } from 'pg';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  buildArtifacts,
  deploymentKubeReferences,
  deploymentRoutes,
  deploymentRuns,
  deployments,
  environments,
  operations,
  organizationQuotaReconciliation,
  organizations,
  projectServices,
  projects,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { upsertDeploymentKubeReference } from '../src/queries/deployment-kube-reference.query';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

export { useApiRuntimeDatabaseTestHarness };

interface DeploymentKubeReferenceDatabaseTestContext {
  readonly apiConfig: ApiConfig;
  readonly databaseUrl: string;
  readonly db: Database;
  readonly pool: Pool;
}

export function createDeploymentKubeReferenceDatabaseTestContext(
  scope: string,
): DeploymentKubeReferenceDatabaseTestContext {
  const { testDatabaseUrl } = readDatabaseTestMode();
  const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, scope);
  const apiConfig: ApiConfig = buildApiConfig(databaseUrl);
  const pool: Pool = createDatabasePool(databaseUrl);
  const db: Database = createDatabase(pool);

  return { apiConfig, databaseUrl, db, pool };
}

export async function seedDeployment(db: Database): Promise<void> {
  await db.insert(organizations).values({ id: 'org_kube', name: 'Kube', slug: 'kube' });
  await db.insert(organizationQuotaReconciliation).values({ organizationId: 'org_kube', state: 'succeeded' });
  await db.insert(projects).values({ id: 'prj_kube', name: 'Kube', organizationId: 'org_kube' });
  await db.insert(projectServices).values({
    id: 'svc_kube',
    kind: 'web',
    name: 'web',
    path: '.',
    projectId: 'prj_kube',
  });
  await db.insert(environments).values({ id: 'env_kube', name: 'production', projectId: 'prj_kube' });
  await seedDeploymentRuntimeRows(db);
  await upsertDeploymentKubeReference({
    deploymentId: 'dep_kube',
    deploymentName: 'app-dep-kube',
    id: 'kref_kube',
    namespace: 'cpt-prj-kube',
    networkPolicyNames: ['app-dep-kube-default-deny'],
    serviceName: 'app-dep-kube',
  });
  await db
    .update(deploymentKubeReferences)
    .set({ state: 'active', transitionedAt: new Date('2026-07-11T10:00:00.000Z') });
}

async function seedDeploymentRuntimeRows(db: Database): Promise<void> {
  await db.insert(operations).values({
    id: 'op_kube',
    status: 'succeeded',
    summary: 'Deploy',
    targetId: 'dep_kube',
    targetType: 'deployment',
    type: 'deployment.create',
  });
  await db.insert(buildArtifacts).values({
    id: 'bar_kube',
    imageRepository: 'repo/kube',
    imageRef: 'repo/kube@sha256:active',
    projectId: 'prj_kube',
    projectServiceId: 'svc_kube',
    resolvedBuildEnvJson: '{}',
    resolvedBuildJson: '{}',
    sourceDigest: 'sha256:kube',
  });
  await db.insert(deploymentRuns).values({ environmentId: 'env_kube', id: 'drn_kube', triggerType: 'manual' });
  await db.insert(deployments).values({
    accessMode: 'authenticated',
    buildArtifactId: 'bar_kube',
    createdAt: new Date('2026-07-11T10:00:00.000Z'),
    deploymentRunId: 'drn_kube',
    environmentId: 'env_kube',
    health: 'healthy',
    id: 'dep_kube',
    isActive: true,
    operationId: 'op_kube',
    projectServiceId: 'svc_kube',
    promotionStage: 'active',
    resolvedPortsJson: '[3000]',
    resolvedReadinessJson: '[]',
    resolvedRoutesJson: '[]',
    resolvedRunJson: '{}',
    status: 'running',
  });
}

export async function seedCandidate(db: Database): Promise<void> {
  await db.insert(operations).values({
    id: 'op_candidate',
    status: 'running',
    summary: 'Deploy',
    targetId: 'dep_candidate',
    targetType: 'deployment',
    type: 'deployment.create',
  });
  await db.insert(buildArtifacts).values({
    id: 'bar_candidate',
    imageRef: 'repo/kube@sha256:candidate',
    imageRepository: 'repo/kube',
    projectId: 'prj_kube',
    projectServiceId: 'svc_kube',
    resolvedBuildEnvJson: '{}',
    resolvedBuildJson: '{}',
    sourceDigest: 'sha256:candidate',
  });
  await db.insert(deploymentRuns).values({ environmentId: 'env_kube', id: 'drn_candidate', triggerType: 'manual' });
  await db.insert(deployments).values({
    accessMode: 'authenticated',
    buildArtifactId: 'bar_candidate',
    createdAt: new Date('2026-07-12T10:00:00.000Z'),
    deploymentRunId: 'drn_candidate',
    environmentId: 'env_kube',
    health: 'pending',
    id: 'dep_candidate',
    isActive: false,
    operationId: 'op_candidate',
    projectServiceId: 'svc_kube',
    promotionStage: 'release',
    resolvedPortsJson: '[3000]',
    resolvedReadinessJson: '[]',
    resolvedRoutesJson: '[]',
    resolvedRunJson: '{}',
    status: 'running',
  });
  await db.insert(deploymentRoutes).values({
    accessScopeId: 'org_kube',
    accessScopeType: 'organization',
    deploymentId: 'dep_candidate',
    id: 'route_kube',
    subdomain: 'kube',
  });
  await upsertDeploymentKubeReference({
    deploymentId: 'dep_candidate',
    deploymentName: 'app-env-kube-svc-kube',
    id: 'kref_candidate',
    namespace: 'cpt-prj-kube',
    networkPolicyNames: [],
    serviceName: 'app-env-kube-svc-kube',
  });
}

function buildApiConfig(url: string): ApiConfig {
  return {
    auditFileSink: defaultAuditFileSinkConfig,
    auditRetentionCleanupBatchSize: 1,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 1,
    usageMeteringIntervalMs: 60_000,
    usageRetentionDays: 400,
    auditRetentionDays: 90,
    baseDomain: 'localhost',
    bindHost: '127.0.0.1',
    tlsMode: 'internal',
    controlPlaneHost: 'compartment.localhost',
    databaseUrl: url,
    edgeToken: 'edge',
    edgeUrl: 'http://127.0.0.1:9081',
    logLevel: 'silent',
    port: 9443,
    publicHttpPort: 9080,
    publicHttpsPort: 443,
    publicProtocol: 'http',
    rollbackRetentionLimit: null,
    runtimeControlToken: 'runtime',
    sessionSecret: 'secret',
    sessionTtlMs: 604_800_000,
    signupEnabled: false,
    sourceArchiveDirectory: '/tmp/sources',
    sourceArchiveMaxBytes: 104_857_600,
    systemApiSocketPath: '/tmp/system.sock',
    systemToken: 'system',
    throttle: defaultApiAuthThrottleConfig,
    trustedOutboundHosts: [],
    tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
    variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
  };
}
