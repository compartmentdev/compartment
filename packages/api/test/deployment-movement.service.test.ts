import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { findProjectServiceByName } from '../src/queries/deployment-context.query';
import type {
  findActiveJoinedDeployment,
  findJoinedDeploymentByEnvironmentAndId,
  listJoinedDeploymentsForEnvironmentRun,
  listJoinedDeploymentsForService,
} from '../src/queries/deployment-joined.query';
import type { DeploymentJoinedRow, ProjectServiceRow } from '../src/queries/deployments.query.types';
import type { DeploymentRuntimeStatus } from '@compartment/contracts';
import type { getApiConfig } from '../src/runtime/runtime-access';
import type {
  listProjectServices,
  requireEnvironmentScopedDeployment,
  requireProjectService,
  resolveExistingEnvironmentContext,
} from '../src/services/deployment-context.service';
import type { queueSerializedArtifactDeploymentMovement } from '../src/services/artifact-deployment-movement.service';
import { rollbackDeploymentForPrincipal } from '../src/services/deployment-movement.service';
import type { RollbackDeploymentInput } from '../src/services/deployment-movement.service.types';
import type { requireActiveHumanRuntimeActor } from '../src/services/runtime-actor-authorization.service';
import { createApiTestConfig } from './api-config-test.fixtures';

type FindActiveJoinedDeployment = typeof findActiveJoinedDeployment;
type FindJoinedDeploymentByEnvironmentAndId = typeof findJoinedDeploymentByEnvironmentAndId;
type FindProjectServiceByName = typeof findProjectServiceByName;
type GetApiConfig = typeof getApiConfig;
type ListJoinedDeploymentsForEnvironmentRun = typeof listJoinedDeploymentsForEnvironmentRun;
type ListJoinedDeploymentsForService = typeof listJoinedDeploymentsForService;
type ListProjectServices = typeof listProjectServices;
type QueueSerializedArtifactDeploymentMovement = typeof queueSerializedArtifactDeploymentMovement;
type RequireActiveHumanRuntimeActor = typeof requireActiveHumanRuntimeActor;
type RequireEnvironmentScopedDeployment = typeof requireEnvironmentScopedDeployment;
type RequireProjectService = typeof requireProjectService;
type ResolveExistingEnvironmentContext = typeof resolveExistingEnvironmentContext;
type TestDeploymentMovementOperationType = 'deployment.create';

interface DeploymentMovementServiceMocks {
  findActiveJoinedDeployment: Mock<FindActiveJoinedDeployment>;
  findJoinedDeploymentByEnvironmentAndId: Mock<FindJoinedDeploymentByEnvironmentAndId>;
  findProjectServiceByName: Mock<FindProjectServiceByName>;
  getApiConfig: Mock<GetApiConfig>;
  listJoinedDeploymentsForEnvironmentRun: Mock<ListJoinedDeploymentsForEnvironmentRun>;
  listJoinedDeploymentsForService: Mock<ListJoinedDeploymentsForService>;
  listProjectServices: Mock<ListProjectServices>;
  queueSerializedArtifactDeploymentMovement: Mock<QueueSerializedArtifactDeploymentMovement>;
  requireActiveHumanRuntimeActor: Mock<RequireActiveHumanRuntimeActor>;
  requireEnvironmentScopedDeployment: Mock<RequireEnvironmentScopedDeployment>;
  requireProjectService: Mock<RequireProjectService>;
  resolveExistingEnvironmentContext: Mock<ResolveExistingEnvironmentContext>;
}

const mocks: DeploymentMovementServiceMocks = vi.hoisted(
  (): DeploymentMovementServiceMocks => ({
    findActiveJoinedDeployment: vi.fn<FindActiveJoinedDeployment>(),
    findJoinedDeploymentByEnvironmentAndId: vi.fn<FindJoinedDeploymentByEnvironmentAndId>(),
    findProjectServiceByName: vi.fn<FindProjectServiceByName>(),
    getApiConfig: vi.fn<GetApiConfig>(),
    listJoinedDeploymentsForEnvironmentRun: vi.fn<ListJoinedDeploymentsForEnvironmentRun>(),
    listJoinedDeploymentsForService: vi.fn<ListJoinedDeploymentsForService>(),
    listProjectServices: vi.fn<ListProjectServices>(),
    queueSerializedArtifactDeploymentMovement: vi.fn<QueueSerializedArtifactDeploymentMovement>(),
    requireActiveHumanRuntimeActor: vi.fn<RequireActiveHumanRuntimeActor>(),
    requireEnvironmentScopedDeployment: vi.fn<RequireEnvironmentScopedDeployment>(),
    requireProjectService: vi.fn<RequireProjectService>(),
    resolveExistingEnvironmentContext: vi.fn<ResolveExistingEnvironmentContext>(),
  }),
);

vi.mock(
  '../src/queries/deployment-context.query',
  (): { findProjectServiceByName: Mock<FindProjectServiceByName> } => ({
    findProjectServiceByName: mocks.findProjectServiceByName,
  }),
);

vi.mock(
  '../src/queries/deployment-joined.query',
  (): {
    findActiveJoinedDeployment: Mock<FindActiveJoinedDeployment>;
    findJoinedDeploymentByEnvironmentAndId: Mock<FindJoinedDeploymentByEnvironmentAndId>;
    listActiveJoinedDeploymentsForEnvironment: Mock<() => Promise<DeploymentJoinedRow[]>>;
    listJoinedDeploymentsForEnvironmentRun: Mock<ListJoinedDeploymentsForEnvironmentRun>;
    listJoinedDeploymentsForService: Mock<ListJoinedDeploymentsForService>;
  } => ({
    findActiveJoinedDeployment: mocks.findActiveJoinedDeployment,
    findJoinedDeploymentByEnvironmentAndId: mocks.findJoinedDeploymentByEnvironmentAndId,
    listActiveJoinedDeploymentsForEnvironment: vi.fn().mockResolvedValue([]),
    listJoinedDeploymentsForEnvironmentRun: mocks.listJoinedDeploymentsForEnvironmentRun,
    listJoinedDeploymentsForService: mocks.listJoinedDeploymentsForService,
  }),
);

vi.mock('../src/runtime/runtime-access', (): { getApiConfig: Mock<GetApiConfig> } => ({
  getApiConfig: mocks.getApiConfig,
}));

vi.mock(
  '../src/services/deployment-context.service',
  (): {
    listProjectServices: Mock<ListProjectServices>;
    requireEnvironmentScopedDeployment: Mock<RequireEnvironmentScopedDeployment>;
    requireProjectService: Mock<RequireProjectService>;
    resolveExistingEnvironmentContext: Mock<ResolveExistingEnvironmentContext>;
    resolveExistingProjectContext: Mock<() => Promise<never>>;
  } => ({
    listProjectServices: mocks.listProjectServices,
    requireEnvironmentScopedDeployment: mocks.requireEnvironmentScopedDeployment,
    requireProjectService: mocks.requireProjectService,
    resolveExistingEnvironmentContext: mocks.resolveExistingEnvironmentContext,
    resolveExistingProjectContext: vi.fn(),
  }),
);

vi.mock(
  '../src/services/artifact-deployment-movement.service',
  (): { queueSerializedArtifactDeploymentMovement: Mock<QueueSerializedArtifactDeploymentMovement> } => ({
    queueSerializedArtifactDeploymentMovement: mocks.queueSerializedArtifactDeploymentMovement,
  }),
);

vi.mock(
  '../src/services/runtime-actor-authorization.service',
  (): { requireActiveHumanRuntimeActor: Mock<RequireActiveHumanRuntimeActor> } => ({
    requireActiveHumanRuntimeActor: mocks.requireActiveHumanRuntimeActor,
  }),
);

describe('deployment movement service', (): void => {
  afterEach((): void => {
    mocks.findActiveJoinedDeployment.mockReset();
    mocks.findJoinedDeploymentByEnvironmentAndId.mockReset();
    mocks.findProjectServiceByName.mockReset();
    mocks.getApiConfig.mockReset();
    mocks.listJoinedDeploymentsForEnvironmentRun.mockReset();
    mocks.listJoinedDeploymentsForService.mockReset();
    mocks.listProjectServices.mockReset();
    mocks.queueSerializedArtifactDeploymentMovement.mockReset();
    mocks.requireActiveHumanRuntimeActor.mockReset();
    mocks.requireEnvironmentScopedDeployment.mockReset();
    mocks.requireProjectService.mockReset();
    mocks.resolveExistingEnvironmentContext.mockReset();
  });

  it('rejects explicit rollback targets whose reusable image was cleaned', async (): Promise<void> => {
    const cleanedDeployment: DeploymentJoinedRow = createDeployment('dep_cleaned', {
      imageRetentionState: 'cleaned',
      isActive: false,
      status: 'succeeded',
    });

    mockRollbackContext();
    mocks.findProjectServiceByName.mockResolvedValueOnce(createProjectService());
    mocks.requireProjectService.mockImplementation((service: ProjectServiceRow | undefined): ProjectServiceRow => {
      if (service === undefined) {
        throw new Error('Expected service.');
      }

      return service;
    });
    mocks.findJoinedDeploymentByEnvironmentAndId.mockResolvedValueOnce(cleanedDeployment);
    mocks.requireEnvironmentScopedDeployment.mockImplementation(
      (deployment: DeploymentJoinedRow | undefined): DeploymentJoinedRow => {
        if (deployment === undefined) {
          throw new Error('Expected deployment.');
        }

        return deployment;
      },
    );

    await expect(
      rollbackDeploymentForPrincipal({
        ...createRollbackInput(),
        target: {
          mode: 'deployment',
          serviceSelection: {
            mode: 'service',
            serviceName: 'web',
          },
          targetDeploymentId: 'dep_cleaned',
        },
      }),
    ).rejects.toMatchObject({
      code: 'deployment_image_cleaned',
    });
    expect(mocks.findJoinedDeploymentByEnvironmentAndId).toHaveBeenCalledWith(
      'env_production',
      'dep_cleaned',
      'localhost',
    );
    expect(mocks.queueSerializedArtifactDeploymentMovement).not.toHaveBeenCalled();
  });

  it('skips cleaned historical targets when resolving implicit rollback', async (): Promise<void> => {
    const activeDeployment: DeploymentJoinedRow = createDeployment('dep_active', {
      isActive: true,
      status: 'succeeded',
    });
    const cleanedPreviousDeployment: DeploymentJoinedRow = createDeployment('dep_cleaned', {
      createdAt: '2026-05-04T12:00:00.000Z',
      imageRetentionState: 'cleaned',
      isActive: false,
      status: 'succeeded',
    });
    const reusablePreviousDeployment: DeploymentJoinedRow = createDeployment('dep_reusable', {
      createdAt: '2026-05-03T12:00:00.000Z',
      isActive: false,
      status: 'succeeded',
    });

    mockRollbackContext();
    mocks.findProjectServiceByName.mockResolvedValueOnce(createProjectService());
    mocks.requireProjectService.mockImplementation((service: ProjectServiceRow | undefined): ProjectServiceRow => {
      if (service === undefined) {
        throw new Error('Expected service.');
      }

      return service;
    });
    mocks.findActiveJoinedDeployment.mockResolvedValueOnce(activeDeployment);
    mocks.listJoinedDeploymentsForService.mockResolvedValueOnce([
      activeDeployment,
      cleanedPreviousDeployment,
      reusablePreviousDeployment,
    ]);
    mocks.queueSerializedArtifactDeploymentMovement.mockResolvedValueOnce([reusablePreviousDeployment]);

    const result: DeploymentJoinedRow[] = await rollbackDeploymentForPrincipal({
      ...createRollbackInput(),
      target: {
        mode: 'previous',
        scope: {
          mode: 'service',
          serviceName: 'web',
        },
      },
    });

    expect(result).toEqual([reusablePreviousDeployment]);
    expect(mocks.queueSerializedArtifactDeploymentMovement).toHaveBeenCalledWith(
      [reusablePreviousDeployment],
      expect.objectContaining({
        id: 'env_production',
      }),
      'prn_123',
      'deployment.rollback',
    );
  });
});

function mockRollbackContext(): void {
  mocks.requireActiveHumanRuntimeActor.mockResolvedValueOnce();
  mocks.getApiConfig.mockReturnValue(createApiTestConfig());
  mocks.resolveExistingEnvironmentContext.mockResolvedValueOnce({
    environment: {
      createdAt: new Date('2026-05-01T12:00:00.000Z'),
      id: 'env_production',
      name: 'production',
      projectId: 'prj_123',
      updatedAt: new Date('2026-05-01T12:00:00.000Z'),
    },
    organization: {
      id: 'org_123',
      name: 'Acme Dev',
      slug: 'acme-dev',
    },
    project: {
      archivedAt: null,
      createdAt: new Date('2026-05-01T12:00:00.000Z'),
      id: 'prj_123',
      name: 'billing',
      organizationId: 'org_123',
      updatedAt: new Date('2026-05-01T12:00:00.000Z'),
    },
  });
}

function createRollbackInput(): RollbackDeploymentInput {
  return {
    actorPrincipalId: 'prn_123',
    environmentName: 'production',
    organizationId: 'org_123',
    organizationSlug: 'acme-dev',
    projectName: 'billing',
    target: {
      mode: 'previous',
      scope: {
        mode: 'all-services',
      },
    },
  };
}

function createProjectService(): ProjectServiceRow {
  return {
    createdAt: new Date('2026-05-01T12:00:00.000Z'),
    id: 'svc_web',
    kind: 'web',
    name: 'web',
    path: '.',
    projectId: 'prj_123',
    updatedAt: new Date('2026-05-01T12:00:00.000Z'),
  };
}

function createDeployment(
  deploymentId: string,
  overrides?: {
    createdAt?: string | undefined;
    imageRetentionState?: 'available' | 'cleaned' | undefined;
    isActive?: boolean | undefined;
    status?: DeploymentRuntimeStatus | undefined;
  },
): DeploymentJoinedRow {
  const createdAt: Date = new Date(overrides?.createdAt ?? '2026-05-05T12:00:00.000Z');
  const operationType: TestDeploymentMovementOperationType = 'deployment.create';

  return {
    artifact: {
      createdAt,
      createdByPrincipalId: 'prn_123',
      id: `art_${deploymentId}`,
      imageRef: `127.0.0.1:39461/repo/${deploymentId}@sha256:${deploymentId}`,
      imageRepository: `repo/${deploymentId}`,
      imageRetentionState: overrides?.imageRetentionState ?? 'available',
      imageCleanedAt: overrides?.imageRetentionState === 'cleaned' ? createdAt : null,
      projectId: 'prj_123',
      projectServiceId: 'svc_web',
      resolvedBuildEnvJson: '{}',
      resolvedBuildJson: '{}',
      sourceDigest: `sha256:${deploymentId}`,
      sourceUploadId: null,
      updatedAt: createdAt,
    },
    deployment: {
      accessMode: 'authenticated',
      buildArtifactId: `art_${deploymentId}`,
      completedAt: createdAt,
      createdAt,
      deploymentRunId: `drn_${deploymentId}`,
      environmentId: 'env_production',
      failureMessage: null,
      health: 'healthy',
      id: deploymentId,
      isActive: overrides?.isActive ?? false,
      label: null,
      movementSourceDeploymentId: null,
      operationId: `op_${deploymentId}`,
      projectServiceId: 'svc_web',
      promotionStage: 'active',
      resolvedPortsJson: '[3000]',
      resolvedReadinessJson: '{}',
      resolvedReleaseJson: 'null',
      resolvedRoutesJson: '[]',
      resolvedRunJson: '{}',
      routeBaseDomain: 'localhost',
      routeHost: 'billing.localhost',
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
      updatedAt: createdAt,
    },
    environment: {
      createdAt,
      id: 'env_production',
      name: 'production',
      projectId: 'prj_123',
      updatedAt: createdAt,
    },
    operation: {
      actorPrincipalId: 'prn_123',
      completedAt: createdAt,
      createdAt,
      id: `op_${deploymentId}`,
      organizationId: 'org_123',
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
    service: createProjectService(),
  };
}
