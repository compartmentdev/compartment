import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CompartmentServiceKind, PermissionKey } from '@compartment/contracts';
import type { ApiConfig } from '../src/config';
import type { listActiveCustomDeploymentRoutesForProjects } from '../src/queries/custom-deployment-routes.query';
import type { DeploymentRouteLookupRow } from '../src/queries/deployment-routes.query.types';
import type {
  listProjectEnvironmentsByProjectIds,
  listProjectServiceCountsByProjectIds,
} from '../src/queries/deployment-context.query';
import type {
  listActiveJoinedDeploymentsForProjects,
  listJoinedDeploymentsForProjects,
} from '../src/queries/deployment-joined.query';
import type {
  DeploymentJoinedRow,
  EnvironmentRow,
  ProjectServiceCountRow,
} from '../src/queries/deployments.query.types';
import type { ProjectRow } from '../src/queries/projects.query.types';
import type { getApiConfig } from '../src/runtime/runtime-access';
import { buildProjectOverviewSummaries } from '../src/services/project-list-overview.service';
import { buildProjectStatusSummaries } from '../src/services/project-list-status.service';
import type { VisibleProjectSummary } from '../src/services/project-visibility.service';
import type { ProjectOverviewListItem, ProjectStatusListItem } from '../src/services/projects.service.types';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

type GetApiConfig = typeof getApiConfig;
type ListActiveCustomDeploymentRoutesForProjects = typeof listActiveCustomDeploymentRoutesForProjects;
type ListActiveJoinedDeploymentsForProjects = typeof listActiveJoinedDeploymentsForProjects;
type ListJoinedDeploymentsForProjects = typeof listJoinedDeploymentsForProjects;
type ListProjectEnvironmentsByProjectIds = typeof listProjectEnvironmentsByProjectIds;
type ListProjectServiceCountsByProjectIds = typeof listProjectServiceCountsByProjectIds;

interface ProjectListOverviewServiceMocks {
  getApiConfig: Mock<GetApiConfig>;
  listActiveCustomDeploymentRoutesForProjects: Mock<ListActiveCustomDeploymentRoutesForProjects>;
  listActiveJoinedDeploymentsForProjects: Mock<ListActiveJoinedDeploymentsForProjects>;
  listJoinedDeploymentsForProjects: Mock<ListJoinedDeploymentsForProjects>;
  listProjectEnvironmentsByProjectIds: Mock<ListProjectEnvironmentsByProjectIds>;
  listProjectServiceCountsByProjectIds: Mock<ListProjectServiceCountsByProjectIds>;
}

interface DeploymentFixtureOptions {
  createdAt?: Date;
  environmentName?: string;
  environmentCreatedAt?: Date;
  serviceKind?: CompartmentServiceKind;
}

const mocks: ProjectListOverviewServiceMocks = vi.hoisted(
  (): ProjectListOverviewServiceMocks => ({
    getApiConfig: vi.fn<GetApiConfig>(),
    listActiveCustomDeploymentRoutesForProjects: vi.fn<ListActiveCustomDeploymentRoutesForProjects>(),
    listActiveJoinedDeploymentsForProjects: vi.fn<ListActiveJoinedDeploymentsForProjects>(),
    listJoinedDeploymentsForProjects: vi.fn<ListJoinedDeploymentsForProjects>(),
    listProjectEnvironmentsByProjectIds: vi.fn<ListProjectEnvironmentsByProjectIds>(),
    listProjectServiceCountsByProjectIds: vi.fn<ListProjectServiceCountsByProjectIds>(),
  }),
);

vi.mock(
  '../src/queries/custom-deployment-routes.query',
  (): {
    listActiveCustomDeploymentRoutesForProjects: Mock<ListActiveCustomDeploymentRoutesForProjects>;
  } => ({
    listActiveCustomDeploymentRoutesForProjects: mocks.listActiveCustomDeploymentRoutesForProjects,
  }),
);

vi.mock(
  '../src/queries/deployment-context.query',
  (): {
    listProjectEnvironmentsByProjectIds: Mock<ListProjectEnvironmentsByProjectIds>;
    listProjectServiceCountsByProjectIds: Mock<ListProjectServiceCountsByProjectIds>;
  } => ({
    listProjectEnvironmentsByProjectIds: mocks.listProjectEnvironmentsByProjectIds,
    listProjectServiceCountsByProjectIds: mocks.listProjectServiceCountsByProjectIds,
  }),
);

vi.mock(
  '../src/queries/deployment-joined.query',
  (): {
    listActiveJoinedDeploymentsForProjects: Mock<ListActiveJoinedDeploymentsForProjects>;
    listJoinedDeploymentsForProjects: Mock<ListJoinedDeploymentsForProjects>;
  } => ({
    listActiveJoinedDeploymentsForProjects: mocks.listActiveJoinedDeploymentsForProjects,
    listJoinedDeploymentsForProjects: mocks.listJoinedDeploymentsForProjects,
  }),
);

vi.mock('../src/runtime/runtime-access', (): { getApiConfig: Mock<GetApiConfig> } => ({
  getApiConfig: mocks.getApiConfig,
}));

describe('project list overview service', (): void => {
  afterEach((): void => {
    mocks.getApiConfig.mockReset();
    mocks.listActiveCustomDeploymentRoutesForProjects.mockReset();
    mocks.listActiveJoinedDeploymentsForProjects.mockReset();
    mocks.listJoinedDeploymentsForProjects.mockReset();
    mocks.listProjectEnvironmentsByProjectIds.mockReset();
    mocks.listProjectServiceCountsByProjectIds.mockReset();
  });

  it('prefers a verified custom domain over the generated route URL', async (): Promise<void> => {
    const project: ProjectRow = createProjectRow('billing');
    const deployment: DeploymentJoinedRow = createDeployment('billing', 'web', 'billing.apps.example.test');
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.listProjectServiceCountsByProjectIds.mockResolvedValueOnce([createServiceCountRow(project.id, 1)]);
    mocks.listJoinedDeploymentsForProjects.mockResolvedValueOnce([deployment]);
    mocks.listActiveJoinedDeploymentsForProjects.mockResolvedValueOnce([deployment]);
    mocks.listActiveCustomDeploymentRoutesForProjects.mockResolvedValueOnce([
      createCustomRoute({
        environmentId: 'env_billing_production',
        host: 'billing.example.com',
        projectId: project.id,
        projectName: project.name,
        serviceId: 'svc_billing_web',
      }),
    ]);
    mocks.listProjectEnvironmentsByProjectIds.mockResolvedValueOnce([createEnvironmentRow(project.id)]);

    const result: ProjectOverviewListItem[] = await buildProjectOverviewSummaries({
      projects: [createVisibleProjectSummary(project)],
    });

    expect(result[0]?.routeUrl).toBe('https://billing.example.com');
    expect(result[0]?.openTargets).toEqual([
      {
        environmentName: 'production',
        routeUrl: 'https://billing.example.com',
        serviceName: 'web',
      },
    ]);
  });

  it('keeps the generated route URL when there is no verified custom domain', async (): Promise<void> => {
    const project: ProjectRow = createProjectRow('billing');
    const deployment: DeploymentJoinedRow = createDeployment('billing', 'web', 'billing.apps.example.test');
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.listProjectServiceCountsByProjectIds.mockResolvedValueOnce([createServiceCountRow(project.id, 1)]);
    mocks.listJoinedDeploymentsForProjects.mockResolvedValueOnce([deployment]);
    mocks.listActiveJoinedDeploymentsForProjects.mockResolvedValueOnce([deployment]);
    mocks.listActiveCustomDeploymentRoutesForProjects.mockResolvedValueOnce([]);
    mocks.listProjectEnvironmentsByProjectIds.mockResolvedValueOnce([createEnvironmentRow(project.id)]);

    const result: ProjectOverviewListItem[] = await buildProjectOverviewSummaries({
      projects: [createVisibleProjectSummary(project)],
    });

    expect(result[0]?.routeUrl).toBe('https://billing.apps.example.test');
    expect(result[0]?.openTargets).toEqual([
      {
        environmentName: 'production',
        routeUrl: 'https://billing.apps.example.test',
        serviceName: 'web',
      },
    ]);
  });

  it('shows app open targets to project viewers without granting deployment-read capability', async (): Promise<void> => {
    const project: ProjectRow = createProjectRow('billing');
    const deployment: DeploymentJoinedRow = createDeployment('billing', 'web', 'billing.apps.example.test');
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.listProjectServiceCountsByProjectIds.mockResolvedValueOnce([createServiceCountRow(project.id, 1)]);
    mocks.listJoinedDeploymentsForProjects.mockResolvedValueOnce([deployment]);
    mocks.listActiveJoinedDeploymentsForProjects.mockResolvedValueOnce([deployment]);
    mocks.listActiveCustomDeploymentRoutesForProjects.mockResolvedValueOnce([]);
    mocks.listProjectEnvironmentsByProjectIds.mockResolvedValueOnce([createEnvironmentRow(project.id)]);

    const result: ProjectOverviewListItem[] = await buildProjectOverviewSummaries({
      projects: [createVisibleProjectSummary(project, ['project.read', 'app.route.access'])],
    });

    expect(result[0]?.canReadDeployments).toBe(false);
    expect(result[0]?.lastDeploymentCreatedAt).toBeNull();
    expect(result[0]?.lifecycleState).toBe('not_deployed');
    expect(result[0]?.serviceCount).toBe(0);
    expect(result[0]?.status).toBe('not_deployed');
    expect(result[0]?.routeUrl).toBe('https://billing.apps.example.test');
    expect(result[0]?.openTargets).toEqual([
      {
        environmentName: 'production',
        routeUrl: 'https://billing.apps.example.test',
        serviceName: 'web',
      },
    ]);
  });

  it('keeps app route access out of status summaries', async (): Promise<void> => {
    const project: ProjectRow = createProjectRow('billing');
    const deployment: DeploymentJoinedRow = createDeployment('billing', 'web', 'billing.apps.example.test');
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.listJoinedDeploymentsForProjects.mockResolvedValueOnce([deployment]);
    mocks.listActiveJoinedDeploymentsForProjects.mockResolvedValueOnce([deployment]);
    mocks.listActiveCustomDeploymentRoutesForProjects.mockResolvedValueOnce([]);
    mocks.listProjectEnvironmentsByProjectIds.mockResolvedValueOnce([createEnvironmentRow(project.id)]);

    const result: ProjectStatusListItem[] = await buildProjectStatusSummaries({
      projects: [createVisibleProjectSummary(project, ['project.read', 'app.route.access'])],
    });

    expect(result[0]).toEqual({
      id: project.id,
      lifecycleAction: null,
      lifecycleDisabledReason: null,
      lifecycleState: 'not_deployed',
      openTargets: [],
      routeUrl: null,
      status: 'not_deployed',
    });
  });

  it('keeps the canonical route URL instead of the first sorted open target', async (): Promise<void> => {
    const project: ProjectRow = createProjectRow('billing');
    const adminDeployment: DeploymentJoinedRow = createDeployment(
      'billing',
      'admin',
      'admin.billing.apps.example.test',
    );
    const webDeployment: DeploymentJoinedRow = createDeployment('billing', 'web', 'billing.apps.example.test');
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.listProjectServiceCountsByProjectIds.mockResolvedValueOnce([createServiceCountRow(project.id, 2)]);
    mocks.listJoinedDeploymentsForProjects.mockResolvedValueOnce([adminDeployment, webDeployment]);
    mocks.listActiveJoinedDeploymentsForProjects.mockResolvedValueOnce([adminDeployment, webDeployment]);
    mocks.listActiveCustomDeploymentRoutesForProjects.mockResolvedValueOnce([]);
    mocks.listProjectEnvironmentsByProjectIds.mockResolvedValueOnce([createEnvironmentRow(project.id)]);

    const result: ProjectOverviewListItem[] = await buildProjectOverviewSummaries({
      projects: [createVisibleProjectSummary(project)],
    });

    expect(result[0]?.openTargets).toEqual([
      {
        environmentName: 'production',
        routeUrl: 'https://admin.billing.apps.example.test',
        serviceName: 'admin',
      },
      {
        environmentName: 'production',
        routeUrl: 'https://billing.apps.example.test',
        serviceName: 'web',
      },
    ]);
    expect(result[0]?.routeUrl).toBe('https://billing.apps.example.test');
  });

  it('keeps production targets first and preserves source order for the rest', async (): Promise<void> => {
    const project: ProjectRow = createProjectRow('billing');
    const stagingWebDeployment: DeploymentJoinedRow = createDeployment(
      'billing',
      'web',
      'billing-staging.apps.example.test',
      {
        environmentCreatedAt: new Date('2026-04-25T10:00:00.000Z'),
        environmentName: 'staging',
      },
    );
    const productionWebDeployment: DeploymentJoinedRow = createDeployment(
      'billing',
      'web',
      'billing.apps.example.test',
      {
        environmentCreatedAt: new Date('2026-04-24T10:00:00.000Z'),
        environmentName: 'production',
      },
    );
    const previewAdminDeployment: DeploymentJoinedRow = createDeployment(
      'billing',
      'admin',
      'admin.billing-preview.apps.example.test',
      {
        environmentCreatedAt: new Date('2026-04-26T10:00:00.000Z'),
        environmentName: 'preview',
      },
    );
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.listProjectServiceCountsByProjectIds.mockResolvedValueOnce([createServiceCountRow(project.id, 2)]);
    mocks.listJoinedDeploymentsForProjects.mockResolvedValueOnce([
      stagingWebDeployment,
      productionWebDeployment,
      previewAdminDeployment,
    ]);
    mocks.listActiveJoinedDeploymentsForProjects.mockResolvedValueOnce([
      stagingWebDeployment,
      productionWebDeployment,
      previewAdminDeployment,
    ]);
    mocks.listActiveCustomDeploymentRoutesForProjects.mockResolvedValueOnce([]);
    mocks.listProjectEnvironmentsByProjectIds.mockResolvedValueOnce([
      createEnvironmentRow(project.id, 'production'),
      createEnvironmentRow(project.id, 'staging'),
      createEnvironmentRow(project.id, 'preview'),
    ]);

    const result: ProjectOverviewListItem[] = await buildProjectOverviewSummaries({
      projects: [createVisibleProjectSummary(project)],
    });

    expect(result[0]?.openTargets).toEqual([
      {
        environmentName: 'production',
        routeUrl: 'https://billing.apps.example.test',
        serviceName: 'web',
      },
      {
        environmentName: 'staging',
        routeUrl: 'https://billing-staging.apps.example.test',
        serviceName: 'web',
      },
      {
        environmentName: 'preview',
        routeUrl: 'https://admin.billing-preview.apps.example.test',
        serviceName: 'admin',
      },
    ]);
  });

  it('defaults the primary environment to the live environment when the default environment is undeployed', async (): Promise<void> => {
    const project: ProjectRow = createProjectRow('billing');
    const stagingDeployment: DeploymentJoinedRow = createDeployment(
      'billing',
      'web',
      'billing-staging.apps.example.test',
      {
        environmentName: 'staging',
      },
    );
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.listProjectServiceCountsByProjectIds.mockResolvedValueOnce([createServiceCountRow(project.id, 1)]);
    mocks.listJoinedDeploymentsForProjects.mockResolvedValueOnce([stagingDeployment]);
    mocks.listActiveJoinedDeploymentsForProjects.mockResolvedValueOnce([stagingDeployment]);
    mocks.listActiveCustomDeploymentRoutesForProjects.mockResolvedValueOnce([]);
    mocks.listProjectEnvironmentsByProjectIds.mockResolvedValueOnce([
      createEnvironmentRow(project.id, 'production'),
      createEnvironmentRow(project.id, 'staging'),
    ]);

    const result: ProjectOverviewListItem[] = await buildProjectOverviewSummaries({
      projects: [createVisibleProjectSummary(project)],
    });

    expect(result[0]?.environmentName).toBe('staging');
    expect(result[0]?.routeUrl).toBe('https://billing-staging.apps.example.test');
  });

  it('keeps production as the primary route when production and staging share the same host depth', async (): Promise<void> => {
    const project: ProjectRow = createProjectRow('billing');
    const stagingDeployment: DeploymentJoinedRow = createDeployment(
      'billing',
      'web',
      'billing-staging.apps.example.test',
      {
        environmentName: 'staging',
      },
    );
    const productionDeployment: DeploymentJoinedRow = createDeployment('billing', 'web', 'billing.apps.example.test', {
      environmentName: 'production',
    });
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.listProjectServiceCountsByProjectIds.mockResolvedValueOnce([createServiceCountRow(project.id, 1)]);
    mocks.listJoinedDeploymentsForProjects.mockResolvedValueOnce([stagingDeployment, productionDeployment]);
    mocks.listActiveJoinedDeploymentsForProjects.mockResolvedValueOnce([stagingDeployment, productionDeployment]);
    mocks.listActiveCustomDeploymentRoutesForProjects.mockResolvedValueOnce([]);
    mocks.listProjectEnvironmentsByProjectIds.mockResolvedValueOnce([
      createEnvironmentRow(project.id, 'production'),
      createEnvironmentRow(project.id, 'staging'),
    ]);

    const result: ProjectOverviewListItem[] = await buildProjectOverviewSummaries({
      projects: [createVisibleProjectSummary(project)],
    });

    expect(result[0]?.routeUrl).toBe('https://billing.apps.example.test');
    expect(result[0]?.environmentName).toBe('production');
  });

  it('prefers the web route over an api route when host depth is tied', async (): Promise<void> => {
    const project: ProjectRow = createProjectRow('billing');
    const apiDeployment: DeploymentJoinedRow = createDeployment('billing', 'api', 'api-billing.apps.example.test', {
      serviceKind: 'api',
    });
    const webDeployment: DeploymentJoinedRow = createDeployment('billing', 'web', 'billing.apps.example.test');
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.listProjectServiceCountsByProjectIds.mockResolvedValueOnce([createServiceCountRow(project.id, 2)]);
    mocks.listJoinedDeploymentsForProjects.mockResolvedValueOnce([apiDeployment, webDeployment]);
    mocks.listActiveJoinedDeploymentsForProjects.mockResolvedValueOnce([apiDeployment, webDeployment]);
    mocks.listActiveCustomDeploymentRoutesForProjects.mockResolvedValueOnce([]);
    mocks.listProjectEnvironmentsByProjectIds.mockResolvedValueOnce([createEnvironmentRow(project.id)]);

    const result: ProjectOverviewListItem[] = await buildProjectOverviewSummaries({
      projects: [createVisibleProjectSummary(project)],
    });

    expect(result[0]?.routeUrl).toBe('https://billing.apps.example.test');
  });

  it('prefers a static browser entrypoint over an api route when names do not include web', async (): Promise<void> => {
    const project: ProjectRow = createProjectRow('billing');
    const apiDeployment: DeploymentJoinedRow = createDeployment('billing', 'api', 'api-billing.apps.example.test', {
      serviceKind: 'api',
    });
    const staticDeployment: DeploymentJoinedRow = createDeployment(
      'billing',
      'frontend',
      'frontend-billing.apps.example.test',
      {
        serviceKind: 'static',
      },
    );
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.listProjectServiceCountsByProjectIds.mockResolvedValueOnce([createServiceCountRow(project.id, 2)]);
    mocks.listJoinedDeploymentsForProjects.mockResolvedValueOnce([apiDeployment, staticDeployment]);
    mocks.listActiveJoinedDeploymentsForProjects.mockResolvedValueOnce([apiDeployment, staticDeployment]);
    mocks.listActiveCustomDeploymentRoutesForProjects.mockResolvedValueOnce([]);
    mocks.listProjectEnvironmentsByProjectIds.mockResolvedValueOnce([createEnvironmentRow(project.id)]);

    const result: ProjectOverviewListItem[] = await buildProjectOverviewSummaries({
      projects: [createVisibleProjectSummary(project)],
    });

    expect(result[0]?.routeUrl).toBe('https://frontend-billing.apps.example.test');
  });

  it('prefers the browser-facing route even when it is live outside production', async (): Promise<void> => {
    const project: ProjectRow = createProjectRow('billing');
    const productionApiDeployment: DeploymentJoinedRow = createDeployment(
      'billing',
      'api',
      'api-billing.apps.example.test',
      {
        serviceKind: 'api',
      },
    );
    const stagingWebDeployment: DeploymentJoinedRow = createDeployment(
      'billing',
      'web',
      'billing-staging.apps.example.test',
      {
        environmentName: 'staging',
      },
    );
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.listProjectServiceCountsByProjectIds.mockResolvedValueOnce([createServiceCountRow(project.id, 2)]);
    mocks.listJoinedDeploymentsForProjects.mockResolvedValueOnce([productionApiDeployment, stagingWebDeployment]);
    mocks.listActiveJoinedDeploymentsForProjects.mockResolvedValueOnce([productionApiDeployment, stagingWebDeployment]);
    mocks.listActiveCustomDeploymentRoutesForProjects.mockResolvedValueOnce([]);
    mocks.listProjectEnvironmentsByProjectIds.mockResolvedValueOnce([
      createEnvironmentRow(project.id, 'production'),
      createEnvironmentRow(project.id, 'staging'),
    ]);

    const result: ProjectOverviewListItem[] = await buildProjectOverviewSummaries({
      projects: [createVisibleProjectSummary(project)],
    });

    expect(result[0]?.routeUrl).toBe('https://billing-staging.apps.example.test');
    expect(result[0]?.environmentName).toBe('staging');
  });

  it('reports deployment-read capability separately from overview visibility', async (): Promise<void> => {
    const project: ProjectRow = createProjectRow('billing');
    const deployment: DeploymentJoinedRow = createDeployment('billing', 'web', 'billing.apps.example.test');
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.listProjectServiceCountsByProjectIds.mockResolvedValueOnce([createServiceCountRow(project.id, 1)]);
    mocks.listJoinedDeploymentsForProjects.mockResolvedValueOnce([deployment]);
    mocks.listActiveJoinedDeploymentsForProjects.mockResolvedValueOnce([deployment]);
    mocks.listActiveCustomDeploymentRoutesForProjects.mockResolvedValueOnce([]);
    mocks.listProjectEnvironmentsByProjectIds.mockResolvedValueOnce([createEnvironmentRow(project.id)]);

    const result: ProjectOverviewListItem[] = await buildProjectOverviewSummaries({
      projects: [
        createVisibleProjectSummary(project, ['environment.read', 'project.archive', 'project.lifecycle.write']),
      ],
    });

    expect(result[0]?.canReadDeployments).toBe(false);
    expect(result[0]?.environmentName).toBe('production');
  });
});

function createApiConfig(): ApiConfig {
  return {
    baseDomain: 'example.test',
    publicHttpPort: 80,
    publicHttpsPort: 443,
    publicProtocol: 'https',
    auditRetentionDays: 90,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    usageMeteringIntervalMs: 60_000,
    usageRetentionDays: 400,
    auditFileSink: defaultAuditFileSinkConfig,
    rollbackRetentionLimit: null,
  } as ApiConfig;
}

function createProjectRow(name: string, archivedAt: Date | null = null): ProjectRow {
  return {
    archivedAt,
    createdAt: new Date('2026-04-25T10:00:00.000Z'),
    id: `prj_${name.replace('-', '_')}`,
    name,
    organizationId: 'org_123',
    updatedAt: new Date('2026-04-26T10:00:00.000Z'),
  };
}

function createVisibleProjectSummary(
  project: ProjectRow,
  permissions: PermissionKey[] = ['environment.read', 'project.archive', 'project.lifecycle.write'],
): VisibleProjectSummary {
  return {
    hasEnvironmentVisibility: false,
    permissions,
    project,
  };
}

function createServiceCountRow(projectId: string, serviceCount: number): ProjectServiceCountRow {
  return {
    projectId,
    serviceCount,
  };
}

function createEnvironmentRow(projectId: string, name: string = 'production'): EnvironmentRow {
  const createdAt: Date = new Date('2026-04-25T10:00:00.000Z');

  return {
    createdAt,
    id: `env_${projectId.replace('prj_', '')}_${name}`,
    name,
    projectId,
    updatedAt: createdAt,
  };
}

function createDeployment(
  projectName: string,
  serviceName: string,
  routeHost: string,
  options?: DeploymentFixtureOptions,
): DeploymentJoinedRow {
  const createdAt: Date = options?.createdAt ?? new Date('2026-04-25T10:00:00.000Z');
  const environmentName: string = options?.environmentName ?? 'production';
  const environmentCreatedAt: Date = options?.environmentCreatedAt ?? createdAt;
  const serviceKind: CompartmentServiceKind = options?.serviceKind ?? 'web';

  return {
    artifact: {
      createdAt,
      createdByPrincipalId: 'prn_123',
      id: `art_${projectName}_${serviceName}`,
      imageRef: 'registry.example/billing:latest',
      imageRepository: 'registry.example/billing',
      imageRetentionState: 'available',
      imageCleanedAt: null,
      projectId: `prj_${projectName}`,
      projectServiceId: `svc_${projectName}_${serviceName}`,
      resolvedBuildEnvJson: '{}',
      resolvedBuildJson: '{}',
      sourceDigest: 'sha256:123',
      sourceUploadId: null,
      updatedAt: createdAt,
    },
    deployment: {
      accessMode: 'authenticated',
      buildArtifactId: `art_${projectName}_${serviceName}`,
      completedAt: createdAt,
      createdAt,
      deploymentRunId: `drn_${projectName}_${serviceName}`,
      environmentId: `env_${projectName}_${environmentName}`,
      failureMessage: null,
      health: 'healthy',
      id: `dep_${projectName}_${serviceName}`,
      isActive: true,
      movementSourceDeploymentId: null,
      label: null,
      operationId: `op_${projectName}_${serviceName}`,
      projectServiceId: `svc_${projectName}_${serviceName}`,
      promotionStage: 'active',
      resolvedPortsJson: '[3000]',
      resolvedReadinessJson: '{}',
      resolvedReleaseJson: 'null',
      resolvedRoutesJson: '[]',
      resolvedRunJson: '{}',
      sourceAutomationPrincipalId: null,
      sourceBindingId: null,
      sourceBindingSnapshotJson: null,
      sourceCommitSha: null,
      sourceEventId: null,
      sourceId: null,
      sourceKind: null,
      sourceRepositorySnapshotJson: null,
      sourceResolutionTaskId: null,
      routeBaseDomain: 'example.test',
      routeHost,
      status: 'succeeded',
      updatedAt: createdAt,
    },
    environment: {
      createdAt: environmentCreatedAt,
      id: `env_${projectName}_${environmentName}`,
      name: environmentName,
      projectId: `prj_${projectName}`,
      updatedAt: environmentCreatedAt,
    },
    operation: {
      actorPrincipalId: 'prn_123',
      completedAt: createdAt,
      createdAt,
      id: `op_${projectName}_${serviceName}`,
      status: 'succeeded',
      summary: 'deployment.run',
      targetId: `dep_${projectName}_${serviceName}`,
      targetType: 'deployment',
      type: 'deployment.run',
    },
    project: createProjectRow(projectName),
    service: {
      createdAt,
      id: `svc_${projectName}_${serviceName}`,
      kind: serviceKind,
      name: serviceName,
      path: `services/${serviceName}`,
      projectId: `prj_${projectName}`,
      updatedAt: createdAt,
    },
  };
}

function createCustomRoute(
  overrides: Partial<DeploymentRouteLookupRow> &
    Pick<DeploymentRouteLookupRow, 'environmentId' | 'host' | 'projectId' | 'projectName' | 'serviceId'>,
): DeploymentRouteLookupRow {
  const { environmentId, host, projectId, projectName, serviceId, ...remainingOverrides } = overrides;

  return {
    accessMode: 'authenticated',
    accessScopeId: 'org_123',
    accessScopeType: 'organization',
    deploymentId: 'dep_billing_web',
    environmentId,
    environmentName: 'production',
    host,
    organizationId: 'org_123',
    organizationSlug: 'acme-dev',
    projectId,
    projectName,
    resolvedRoutesJson: '[]',
    serviceId,
    serviceName: 'web',
    upstreamHost: '127.0.0.1',
    upstreamPort: 32000,
    ...remainingOverrides,
  };
}
