import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiConfig } from '../src/config';
import type { DeploymentRuntimeStatus } from '@compartment/contracts';
import type { getApiConfig } from '../src/runtime/runtime-access';
import type { listJoinedDeploymentsByProjectService } from '../src/queries/deployment-joined.query';
import type { markBuildArtifactsCleaned } from '../src/queries/deployments.query';
import type { DeploymentJoinedRow } from '../src/queries/deployments.query.types';
import type { readOrganizationRollbackRetentionSettings } from '../src/services/organization-settings.service';
import type { cleanupDeploymentSourceArchive } from '../src/services/source-archive-cleanup.service';
import { planRollbackRetentionCleanup } from '../src/services/deployment-retention.service';

type GetApiConfig = typeof getApiConfig;
type ListJoinedDeploymentsByProjectService = typeof listJoinedDeploymentsByProjectService;
type MarkBuildArtifactsCleaned = typeof markBuildArtifactsCleaned;
type ReadOrganizationRollbackRetentionSettings = typeof readOrganizationRollbackRetentionSettings;
type CleanupDeploymentSourceArchive = typeof cleanupDeploymentSourceArchive;
type TestDeploymentRetentionOperationType =
  | 'deployment.create'
  | 'deployment.promote'
  | 'deployment.rollback'
  | 'deployment.run'
  | 'deployment.stop';

interface DeploymentRetentionServiceMocks {
  getApiConfig: Mock<GetApiConfig>;
  cleanupDeploymentSourceArchive: Mock<CleanupDeploymentSourceArchive>;
  listJoinedDeploymentsByProjectService: Mock<ListJoinedDeploymentsByProjectService>;
  markBuildArtifactsCleaned: Mock<MarkBuildArtifactsCleaned>;
  readOrganizationRollbackRetentionSettings: Mock<ReadOrganizationRollbackRetentionSettings>;
}

const mocks: DeploymentRetentionServiceMocks = vi.hoisted(
  (): DeploymentRetentionServiceMocks => ({
    getApiConfig: vi.fn<GetApiConfig>(),
    cleanupDeploymentSourceArchive: vi.fn<CleanupDeploymentSourceArchive>(),
    listJoinedDeploymentsByProjectService: vi.fn<ListJoinedDeploymentsByProjectService>(),
    markBuildArtifactsCleaned: vi.fn<MarkBuildArtifactsCleaned>(),
    readOrganizationRollbackRetentionSettings: vi.fn<ReadOrganizationRollbackRetentionSettings>(),
  }),
);

vi.mock('../src/runtime/runtime-access', (): { getApiConfig: Mock<GetApiConfig> } => ({
  getApiConfig: mocks.getApiConfig,
}));

vi.mock(
  '../src/queries/deployment-joined.query',
  (): { listJoinedDeploymentsByProjectService: Mock<ListJoinedDeploymentsByProjectService> } => ({
    listJoinedDeploymentsByProjectService: mocks.listJoinedDeploymentsByProjectService,
  }),
);

vi.mock('../src/queries/deployments.query', (): { markBuildArtifactsCleaned: Mock<MarkBuildArtifactsCleaned> } => ({
  markBuildArtifactsCleaned: mocks.markBuildArtifactsCleaned,
}));

vi.mock(
  '../src/services/source-archive-cleanup.service',
  (): { cleanupDeploymentSourceArchive: Mock<CleanupDeploymentSourceArchive> } => ({
    cleanupDeploymentSourceArchive: mocks.cleanupDeploymentSourceArchive,
  }),
);

vi.mock(
  '../src/services/organization-settings.service',
  (): { readOrganizationRollbackRetentionSettings: Mock<ReadOrganizationRollbackRetentionSettings> } => ({
    readOrganizationRollbackRetentionSettings: mocks.readOrganizationRollbackRetentionSettings,
  }),
);

describe('deployment retention service', (): void => {
  afterEach((): void => {
    mocks.getApiConfig.mockReset();
    mocks.cleanupDeploymentSourceArchive.mockReset();
    mocks.listJoinedDeploymentsByProjectService.mockReset();
    mocks.markBuildArtifactsCleaned.mockReset();
    mocks.readOrganizationRollbackRetentionSettings.mockReset();
  });

  it('skips cleanup for operations outside deploy run promote and rollback', async (): Promise<void> => {
    const deployment: DeploymentJoinedRow = createDeployment('dep_run', 'art_run', 'production', {
      operationType: 'deployment.stop',
    });

    await expect(planRollbackRetentionCleanup(deployment)).resolves.toEqual([]);
    expect(mocks.readOrganizationRollbackRetentionSettings).not.toHaveBeenCalled();
  });

  it('skips cleanup when the effective policy is indefinite', async (): Promise<void> => {
    mocks.readOrganizationRollbackRetentionSettings.mockResolvedValueOnce({
      configured: {
        limit: null,
        mode: 'inherit',
      },
      effective: {
        limit: null,
        mode: 'indefinite',
      },
      instanceDefault: {
        limit: null,
        mode: 'indefinite',
      },
    });

    await expect(
      planRollbackRetentionCleanup(createDeployment('dep_current', 'art_current', 'production')),
    ).resolves.toEqual([]);
    expect(mocks.listJoinedDeploymentsByProjectService).not.toHaveBeenCalled();
  });

  it('cleans only artifacts that fall outside every retained environment window', async (): Promise<void> => {
    const currentDeployment: DeploymentJoinedRow = createDeployment('dep_prod_new', 'art_new', 'production', {
      createdAt: '2026-05-06T12:00:00.000Z',
      imageRef: '127.0.0.1:39461/repo/art_new@sha256:new',
    });
    const prodOldSharedDeployment: DeploymentJoinedRow = createDeployment('dep_prod_old', 'art_shared', 'production', {
      createdAt: '2026-05-03T12:00:00.000Z',
      imageRef: '127.0.0.1:39461/repo/art_shared@sha256:shared',
    });
    const stagingCurrentSharedDeployment: DeploymentJoinedRow = createDeployment(
      'dep_staging_new',
      'art_shared',
      'staging',
      {
        createdAt: '2026-05-07T12:00:00.000Z',
        imageRef: '127.0.0.1:39461/repo/art_shared@sha256:shared',
      },
    );
    const stagingOldDeployment: DeploymentJoinedRow = createDeployment('dep_staging_old', 'art_old', 'staging', {
      createdAt: '2026-05-01T12:00:00.000Z',
      imageRef: '127.0.0.1:39461/repo/art_old@sha256:old',
    });
    const queuedDeployment: DeploymentJoinedRow = createDeployment('dep_queued', 'art_queued', 'production', {
      createdAt: '2026-05-08T12:00:00.000Z',
      imageRef: '127.0.0.1:39461/repo/art_queued@sha256:queued',
      status: 'queued',
    });

    mocks.getApiConfig.mockReturnValue({
      baseDomain: 'localhost',
    } as ApiConfig);
    mocks.readOrganizationRollbackRetentionSettings.mockResolvedValueOnce({
      configured: {
        limit: 1,
        mode: 'keep_last',
      },
      effective: {
        limit: 1,
        mode: 'keep_last',
      },
      instanceDefault: {
        limit: 5,
        mode: 'keep_last',
      },
    });
    mocks.listJoinedDeploymentsByProjectService.mockResolvedValueOnce([
      currentDeployment,
      prodOldSharedDeployment,
      stagingCurrentSharedDeployment,
      stagingOldDeployment,
      queuedDeployment,
    ]);
    mocks.markBuildArtifactsCleaned.mockResolvedValueOnce([stagingOldDeployment.artifact]);

    await expect(planRollbackRetentionCleanup(currentDeployment)).resolves.toEqual([
      {
        artifactId: 'art_old',
        imageRef: '127.0.0.1:39461/repo/art_old@sha256:old',
      },
    ]);
    expect(mocks.listJoinedDeploymentsByProjectService).toHaveBeenCalledWith('svc_web', 'localhost');
    expect(mocks.markBuildArtifactsCleaned).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactIds: ['art_old'],
      }),
    );
    expect(mocks.cleanupDeploymentSourceArchive).toHaveBeenCalledWith(stagingOldDeployment.artifact);
  });
});

function createDeployment(
  deploymentId: string,
  artifactId: string,
  environmentName: string,
  overrides?: {
    createdAt?: string | undefined;
    imageRef?: string | null | undefined;
    operationType?: TestDeploymentRetentionOperationType | undefined;
    status?: DeploymentRuntimeStatus | undefined;
  },
): DeploymentJoinedRow {
  const createdAt: Date = new Date(overrides?.createdAt ?? '2026-05-05T12:00:00.000Z');
  const operationType: TestDeploymentRetentionOperationType = overrides?.operationType ?? 'deployment.create';

  return {
    artifact: {
      createdAt,
      createdByPrincipalId: 'prn_123',
      id: artifactId,
      imageRef: overrides?.imageRef ?? `127.0.0.1:39461/repo/${artifactId}@sha256:${artifactId}`,
      imageRepository: `repo/${artifactId}`,
      imageRetentionState: 'available',
      imageCleanedAt: null,
      projectId: 'prj_123',
      projectServiceId: 'svc_web',
      resolvedBuildEnvJson: '{}',
      resolvedBuildJson: '{}',
      sourceDigest: `sha256:${artifactId}`,
      sourceUploadId: `sup_${artifactId}`,
      updatedAt: createdAt,
    },
    deployment: {
      accessMode: 'authenticated',
      buildArtifactId: artifactId,
      completedAt: createdAt,
      containerId: `ctr_${deploymentId}`,
      createdAt,
      deploymentRunId: `drn_${deploymentId}`,
      drainDeadlineAt: null,
      drainingContainerId: null,
      drainingDeploymentId: null,
      drainingNodeId: null,
      environmentId: `env_${environmentName}`,
      failureMessage: null,
      health: 'healthy',
      id: deploymentId,
      isActive: deploymentId === 'dep_prod_new' || deploymentId === 'dep_staging_new',
      label: null,
      movementSourceDeploymentId: null,
      nodeId: 'node_123',
      operationId: `op_${deploymentId}`,
      projectServiceId: 'svc_web',
      promotionStage: 'active',
      resolvedReadinessJson: '{}',
      resolvedReleaseJson: 'null',
      resolvedRoutesJson: '[]',
      resolvedRunJson: '{}',
      routeBaseDomain: 'localhost',
      routeHost: `${environmentName}.localhost`,
      sourceAutomationPrincipalId: null,
      sourceBindingId: null,
      sourceBindingSnapshotJson: null,
      sourceCommitSha: null,
      sourceEventId: null,
      sourceId: null,
      sourceKind: null,
      sourceRepositorySnapshotJson: null,
      sourceResolutionTaskId: null,
      status: overrides?.status ?? 'succeeded',
      upstreamHost: '127.0.0.1',
      upstreamPort: 31000,
      updatedAt: createdAt,
    },
    environment: {
      createdAt,
      id: `env_${environmentName}`,
      name: environmentName,
      nodeId: 'node_123',
      projectId: 'prj_123',
      updatedAt: createdAt,
    },
    operation: {
      actorPrincipalId: 'prn_123',
      completedAt: createdAt,
      createdAt,
      id: `op_${deploymentId}`,
      status: 'succeeded',
      summary: deploymentId,
      targetId: deploymentId,
      targetType: 'deployment',
      type: operationType,
    },
    project: {
      archivedAt: null,
      createdAt,
      id: 'prj_123',
      name: 'billing',
      organizationId: 'org_123',
      updatedAt: createdAt,
    },
    service: {
      createdAt,
      id: 'svc_web',
      kind: 'web',
      name: 'web',
      path: '.',
      projectId: 'prj_123',
      updatedAt: createdAt,
    },
  };
}
