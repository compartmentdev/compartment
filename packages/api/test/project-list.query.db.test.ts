import {
  defaultCompartmentEnvironmentName,
  type CompartmentServiceKind,
  type DeploymentRuntimeHealth,
  type DeploymentRuntimeStatus,
  type DeploymentPromotionStage,
} from '@compartment/contracts';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  buildArtifacts,
  deploymentRoutes,
  deploymentRuns,
  deployments,
  environments,
  operations,
  organizations,
  projects,
  projectServices,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { listOverviewProjectRowsPageByOrganization } from '../src/queries/project-list.query';
import type {
  ListOverviewProjectRowsPageByOrganizationInput,
  ProjectListRowsPage,
} from '../src/queries/project-list.query.types';
import type { ProjectRow } from '../src/queries/projects.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

const { testDatabaseUrl } = readDatabaseTestMode();
const projectListQueryDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'project_list_query');
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  tlsMode: 'internal',
  controlPlaneHost: 'compartment.localhost',
  databaseUrl: projectListQueryDatabaseUrl,
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
  usageMeteringIntervalMs: 60_000,
  usageRetentionDays: 400,
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
const pool: Pool = createDatabasePool(projectListQueryDatabaseUrl);
const db: Database = createDatabase(pool);

interface InsertDeploymentInput {
  createdAt: Date;
  health: DeploymentRuntimeHealth;
  id: string;
  isActive: boolean;
  projectName: string;
  promotionStage: DeploymentPromotionStage;
  routeSubdomain?: string | undefined;
  serviceName: string;
  status: DeploymentRuntimeStatus;
}

type ProjectServiceInsert = typeof projectServices.$inferInsert;

describe('project list db query', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: projectListQueryDatabaseUrl,
    db,
    pool,
  });

  it('orders, searches, and paginates overview project rows in SQL', async (): Promise<void> => {
    await createQueryTestScope();
    await insertProject('api', ['web']);
    await insertProject('billing', ['web', 'worker', 'cron']);
    await insertProject('console', ['web', 'worker']);
    await insertProject('retired', ['web'], new Date('2026-04-25T10:00:00.000Z'));
    await insertDeployment({
      createdAt: new Date('2026-04-24T09:00:00.000Z'),
      health: 'unhealthy',
      id: 'dep_billing_failed',
      isActive: false,
      projectName: 'billing',
      promotionStage: 'active',
      serviceName: 'web',
      status: 'failed',
    });
    await insertDeployment({
      createdAt: new Date('2026-04-24T10:00:00.000Z'),
      health: 'healthy',
      id: 'dep_billing_ready',
      isActive: true,
      projectName: 'billing',
      promotionStage: 'active',
      routeSubdomain: 'billing',
      serviceName: 'web',
      status: 'succeeded',
    });
    await insertDeployment({
      createdAt: new Date('2026-04-24T11:00:00.000Z'),
      health: 'unhealthy',
      id: 'dep_console_failed',
      isActive: false,
      projectName: 'console',
      promotionStage: 'active',
      serviceName: 'web',
      status: 'failed',
    });

    const serviceCountPage: ProjectListRowsPage = await listOverviewProjectRowsPageByOrganization(
      createListInput({
        orderBy: 'serviceCount',
        page: 2,
        perPage: 1,
        sort: 'desc',
      }),
    );
    const statusPage: ProjectListRowsPage = await listOverviewProjectRowsPageByOrganization(
      createListInput({
        orderBy: 'status',
        page: 1,
        perPage: 2,
        sort: 'desc',
      }),
    );
    const lastDeploymentPage: ProjectListRowsPage = await listOverviewProjectRowsPageByOrganization(
      createListInput({
        orderBy: 'lastDeploymentCreatedAt',
        page: 1,
        perPage: 3,
        sort: 'asc',
      }),
    );
    const outOfRangePage: ProjectListRowsPage = await listOverviewProjectRowsPageByOrganization(
      createListInput({
        orderBy: 'serviceCount',
        page: 9,
        perPage: 2,
        sort: 'desc',
      }),
    );
    const routeSearchPage: ProjectListRowsPage = await listOverviewProjectRowsPageByOrganization(
      createListInput({
        orderBy: 'name',
        search: 'https://billing.apps.test:8443',
        sort: 'asc',
      }),
    );
    const combinedSearchPage: ProjectListRowsPage = await listOverviewProjectRowsPageByOrganization(
      createListInput({
        orderBy: 'name',
        search: 'billing https://',
        sort: 'asc',
      }),
    );
    const archivedPage: ProjectListRowsPage = await listOverviewProjectRowsPageByOrganization(
      createListInput({
        archiveState: 'archived',
        orderBy: 'status',
        sort: 'asc',
      }),
    );
    const allProjectsPage: ProjectListRowsPage = await listOverviewProjectRowsPageByOrganization(
      createListInput({
        archiveState: 'all',
        orderBy: 'name',
        page: 2,
        perPage: 2,
        sort: 'asc',
      }),
    );
    const emptySearchPage: ProjectListRowsPage = await listOverviewProjectRowsPageByOrganization(
      createListInput({
        search: 'missing.example.test',
      }),
    );

    expect(serviceCountPage.pagination).toEqual({
      page: 2,
      perPage: 1,
      totalItems: 3,
      totalPages: 3,
    });
    expect(serviceCountPage.projects.map((project: ProjectRow): string => project.name)).toEqual(['console']);
    expect(statusPage.projects.map((project: ProjectRow): string => project.name)).toEqual(['console', 'billing']);
    expect(lastDeploymentPage.projects.map((project: ProjectRow): string => project.name)).toEqual([
      'api',
      'billing',
      'console',
    ]);
    expect(outOfRangePage.pagination).toEqual({
      page: 2,
      perPage: 2,
      totalItems: 3,
      totalPages: 2,
    });
    expect(outOfRangePage.projects.map((project: ProjectRow): string => project.name)).toEqual(['api']);
    expect(routeSearchPage.pagination.totalItems).toBe(1);
    expect(routeSearchPage.projects.map((project: ProjectRow): string => project.name)).toEqual(['billing']);
    expect(routeSearchPage.projects[0]?.createdAt).toBeInstanceOf(Date);
    expect(combinedSearchPage.pagination.totalItems).toBe(1);
    expect(combinedSearchPage.projects.map((project: ProjectRow): string => project.name)).toEqual(['billing']);
    expect(archivedPage.pagination).toEqual({
      page: 1,
      perPage: 10,
      totalItems: 1,
      totalPages: 1,
    });
    expect(archivedPage.projects.map((project: ProjectRow): string => project.name)).toEqual(['retired']);
    expect(archivedPage.projects[0]?.archivedAt).toBeInstanceOf(Date);
    expect(allProjectsPage.pagination).toEqual({
      page: 2,
      perPage: 2,
      totalItems: 4,
      totalPages: 2,
    });
    expect(allProjectsPage.projects.map((project: ProjectRow): string => project.name)).toEqual(['console', 'retired']);
    expect(emptySearchPage.pagination).toEqual({
      page: 1,
      perPage: 10,
      totalItems: 0,
      totalPages: 1,
    });
    expect(emptySearchPage.projects).toEqual([]);
  });
});

async function createQueryTestScope(): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_project_list',
    name: 'Project List Org',
    slug: 'project-list-org',
  });
}

async function insertProject(name: string, serviceNames: string[], archivedAt: Date | null = null): Promise<void> {
  const serviceValues: ProjectServiceInsert[] = serviceNames.map(
    (serviceName: string): ProjectServiceInsert => ({
      id: readServiceId(name, serviceName),
      kind: readServiceKind(serviceName),
      name: serviceName,
      path: '.',
      projectId: readProjectId(name),
      updatedAt: new Date('2026-04-24T08:00:00.000Z'),
    }),
  );

  await db.insert(projects).values({
    archivedAt,
    id: readProjectId(name),
    name,
    organizationId: 'org_project_list',
    updatedAt: new Date('2026-04-24T08:00:00.000Z'),
  });
  await db.insert(environments).values({
    id: readEnvironmentId(name),
    name: defaultCompartmentEnvironmentName,
    projectId: readProjectId(name),
    updatedAt: new Date('2026-04-24T08:00:00.000Z'),
  });
  await db.insert(projectServices).values(serviceValues);
}

async function insertDeployment(input: InsertDeploymentInput): Promise<void> {
  await db.insert(buildArtifacts).values({
    id: `${input.id}_artifact`,
    imageRepository: 'ghcr.io/compartmentdev/compartment-node',
    projectId: readProjectId(input.projectName),
    projectServiceId: readServiceId(input.projectName, input.serviceName),
    resolvedBuildEnvJson: '{}',
    resolvedBuildJson: '{}',
    sourceDigest: `sha256:${input.id}`,
    updatedAt: input.createdAt,
  });
  await db.insert(operations).values({
    id: `${input.id}_operation`,
    status: 'completed',
    summary: `Deploy ${input.projectName} ${input.serviceName}`,
    targetId: input.id,
    targetType: 'deployment',
    type: 'deployment.create',
  });
  await db.insert(deploymentRuns).values({
    createdAt: input.createdAt,
    environmentId: readEnvironmentId(input.projectName),
    id: `${input.id}_run`,
    label: null,
    triggerType: 'manual',
    updatedAt: input.createdAt,
  });
  await db.insert(deployments).values({
    accessMode: 'authenticated',
    buildArtifactId: `${input.id}_artifact`,
    createdAt: input.createdAt,
    deploymentRunId: `${input.id}_run`,
    environmentId: readEnvironmentId(input.projectName),
    health: input.health,
    id: input.id,
    isActive: input.isActive,
    operationId: `${input.id}_operation`,
    projectServiceId: readServiceId(input.projectName, input.serviceName),
    promotionStage: input.promotionStage,
    resolvedPortsJson: '[3000]',
    resolvedReadinessJson: '{}',
    resolvedRoutesJson: '[]',
    resolvedRunJson: '{}',
    status: input.status,
    updatedAt: input.createdAt,
  });
  if (input.routeSubdomain !== undefined) {
    await db.insert(deploymentRoutes).values({
      accessScopeId: 'org_project_list',
      accessScopeType: 'organization',
      deploymentId: input.id,
      id: `${input.id}_route`,
      subdomain: input.routeSubdomain,
      updatedAt: input.createdAt,
    });
  }
}

function createListInput(
  options: Partial<ListOverviewProjectRowsPageByOrganizationInput>,
): ListOverviewProjectRowsPageByOrganizationInput {
  return {
    archiveState: 'active',
    orderBy: 'name',
    organizationId: 'org_project_list',
    page: 1,
    perPage: 10,
    routeBaseDomain: 'apps.test',
    routeUrlPrefix: 'https://',
    routeUrlSuffix: ':8443',
    search: null,
    sort: 'asc',
    ...options,
  };
}

function readProjectId(projectName: string): string {
  return `prj_${projectName}`;
}

function readEnvironmentId(projectName: string): string {
  return `env_${projectName}`;
}

function readServiceId(projectName: string, serviceName: string): string {
  return `svc_${projectName}_${serviceName}`;
}

function readServiceKind(serviceName: string): CompartmentServiceKind {
  return serviceName === 'worker' ? 'worker' : 'web';
}
