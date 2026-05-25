import type { OperationStatus } from '@compartment/contracts';
import type { NodeRequester, stopNodeDeployment } from '@compartment/sdk';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { findEnvironmentByProjectAndName } from '../src/queries/deployment-context.query';
import type {
  findJoinedDeploymentById,
  listActiveJoinedDeploymentsForEnvironment,
  listJoinedDeploymentsForEnvironment,
} from '../src/queries/deployment-joined.query';
import type { markDeploymentStopped } from '../src/queries/deployment-lifecycle.query';
import type { DeploymentJoinedRow, DeploymentRow, EnvironmentRow } from '../src/queries/deployments.query.types';
import type { findNodeById } from '../src/queries/node.query';
import type { NodeRow } from '../src/queries/node.query.types';
import type { insertOperationRecord, updateOperationRecord } from '../src/queries/operations.query';
import type { OperationRecord } from '../src/queries/operations.query.types';
import type { ProjectRow } from '../src/queries/projects.query.types';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import type { getApiConfig } from '../src/runtime/runtime-access';
import type { requireScopedPermission } from '../src/services/access-scope.service';
import type { queueArtifactStartDeployments } from '../src/services/artifact-deployment-queue.service';
import type { createNodeRuntimeRequester } from '../src/services/node-runtime-requester';
import type { resolveActiveProjectScope } from '../src/services/project-scope.service';
import type { ResolvedProjectScope } from '../src/services/project-scope.service.types';
import { startProjectForPrincipal, stopProjectForPrincipal } from '../src/services/project-lifecycle.service';
import type { ProjectLifecycleInput, ProjectLifecycleResult } from '../src/services/project-lifecycle.service.types';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

type FindEnvironmentByProjectAndName = typeof findEnvironmentByProjectAndName;
type FindJoinedDeploymentById = typeof findJoinedDeploymentById;
type FindNodeById = typeof findNodeById;
type GetApiConfig = typeof getApiConfig;
type InsertOperationRecord = typeof insertOperationRecord;
type UpdateOperationRecord = typeof updateOperationRecord;
type ListActiveJoinedDeploymentsForEnvironment = typeof listActiveJoinedDeploymentsForEnvironment;
type ListJoinedDeploymentsForEnvironment = typeof listJoinedDeploymentsForEnvironment;
type MarkDeploymentStopped = typeof markDeploymentStopped;
type RequireScopedPermission = typeof requireScopedPermission;
type CreateNodeRuntimeRequester = typeof createNodeRuntimeRequester;
type QueueArtifactStartDeployments = typeof queueArtifactStartDeployments;
type ResolveActiveProjectScope = typeof resolveActiveProjectScope;
type StopNodeDeployment = typeof stopNodeDeployment;

interface ProjectLifecycleServiceMocks {
  findEnvironmentByProjectAndName: Mock<FindEnvironmentByProjectAndName>;
  findJoinedDeploymentById: Mock<FindJoinedDeploymentById>;
  findNodeById: Mock<FindNodeById>;
  getApiConfig: Mock<GetApiConfig>;
  createNodeRuntimeRequester: Mock<CreateNodeRuntimeRequester>;
  insertOperationRecord: Mock<InsertOperationRecord>;
  listActiveJoinedDeploymentsForEnvironment: Mock<ListActiveJoinedDeploymentsForEnvironment>;
  listJoinedDeploymentsForEnvironment: Mock<ListJoinedDeploymentsForEnvironment>;
  markDeploymentStopped: Mock<MarkDeploymentStopped>;
  queueArtifactStartDeployments: Mock<QueueArtifactStartDeployments>;
  requireScopedPermission: Mock<RequireScopedPermission>;
  resolveActiveProjectScope: Mock<ResolveActiveProjectScope>;
  stopNodeDeployment: Mock<StopNodeDeployment>;
  updateOperationRecord: Mock<UpdateOperationRecord>;
}

const mocks: ProjectLifecycleServiceMocks = vi.hoisted(
  (): ProjectLifecycleServiceMocks => ({
    findEnvironmentByProjectAndName: vi.fn<FindEnvironmentByProjectAndName>(),
    findJoinedDeploymentById: vi.fn<FindJoinedDeploymentById>(),
    findNodeById: vi.fn<FindNodeById>(),
    getApiConfig: vi.fn<GetApiConfig>(),
    createNodeRuntimeRequester: vi.fn<CreateNodeRuntimeRequester>(),
    insertOperationRecord: vi.fn<InsertOperationRecord>(),
    listActiveJoinedDeploymentsForEnvironment: vi.fn<ListActiveJoinedDeploymentsForEnvironment>(),
    listJoinedDeploymentsForEnvironment: vi.fn<ListJoinedDeploymentsForEnvironment>(),
    markDeploymentStopped: vi.fn<MarkDeploymentStopped>(),
    queueArtifactStartDeployments: vi.fn<QueueArtifactStartDeployments>(),
    requireScopedPermission: vi.fn<RequireScopedPermission>(),
    resolveActiveProjectScope: vi.fn<ResolveActiveProjectScope>(),
    stopNodeDeployment: vi.fn<StopNodeDeployment>(),
    updateOperationRecord: vi.fn<UpdateOperationRecord>(),
  }),
);

vi.mock(
  '../src/queries/deployment-context.query',
  (): { findEnvironmentByProjectAndName: Mock<FindEnvironmentByProjectAndName> } => ({
    findEnvironmentByProjectAndName: mocks.findEnvironmentByProjectAndName,
  }),
);

vi.mock(
  '../src/queries/deployment-joined.query',
  (): {
    findJoinedDeploymentById: Mock<FindJoinedDeploymentById>;
    listActiveJoinedDeploymentsForEnvironment: Mock<ListActiveJoinedDeploymentsForEnvironment>;
    listJoinedDeploymentsForEnvironment: Mock<ListJoinedDeploymentsForEnvironment>;
  } => ({
    findJoinedDeploymentById: mocks.findJoinedDeploymentById,
    listActiveJoinedDeploymentsForEnvironment: mocks.listActiveJoinedDeploymentsForEnvironment,
    listJoinedDeploymentsForEnvironment: mocks.listJoinedDeploymentsForEnvironment,
  }),
);

vi.mock('../src/queries/deployment-lifecycle.query', (): { markDeploymentStopped: Mock<MarkDeploymentStopped> } => ({
  markDeploymentStopped: mocks.markDeploymentStopped,
}));

vi.mock('../src/queries/node.query', (): { findNodeById: Mock<FindNodeById> } => ({
  findNodeById: mocks.findNodeById,
}));

vi.mock('../src/runtime/runtime-access', (): { getApiConfig: Mock<GetApiConfig> } => ({
  getApiConfig: mocks.getApiConfig,
}));

vi.mock('../src/services/access-scope.service', (): { requireScopedPermission: Mock<RequireScopedPermission> } => ({
  requireScopedPermission: mocks.requireScopedPermission,
}));

vi.mock(
  '../src/services/node-runtime-requester',
  (): { createNodeRuntimeRequester: Mock<CreateNodeRuntimeRequester> } => ({
    createNodeRuntimeRequester: mocks.createNodeRuntimeRequester,
  }),
);

vi.mock(
  '../src/queries/operations.query',
  (): {
    insertOperationRecord: Mock<InsertOperationRecord>;
    updateOperationRecord: Mock<UpdateOperationRecord>;
  } => ({
    insertOperationRecord: mocks.insertOperationRecord,
    updateOperationRecord: mocks.updateOperationRecord,
  }),
);

vi.mock(
  '../src/services/artifact-deployment-queue.service',
  (): { queueArtifactStartDeployments: Mock<QueueArtifactStartDeployments> } => ({
    queueArtifactStartDeployments: mocks.queueArtifactStartDeployments,
  }),
);

vi.mock(
  '../src/services/project-scope.service',
  (): { resolveActiveProjectScope: Mock<ResolveActiveProjectScope> } => ({
    resolveActiveProjectScope: mocks.resolveActiveProjectScope,
  }),
);

vi.mock('@compartment/sdk', (): { stopNodeDeployment: Mock<StopNodeDeployment> } => ({
  stopNodeDeployment: mocks.stopNodeDeployment,
}));

describe('project lifecycle service', (): void => {
  it('records a failed stop operation when runtime stop fails', async (): Promise<void> => {
    const runningDeployment: DeploymentJoinedRow = createDeployment('web');
    mockLifecycleContext([runningDeployment], [runningDeployment]);
    mocks.findNodeById.mockResolvedValueOnce(createNode());
    mocks.createNodeRuntimeRequester.mockReturnValueOnce(createNodeRequesterMock());
    mocks.insertOperationRecord.mockResolvedValueOnce(createOperationRecord('running'));
    mocks.stopNodeDeployment.mockRejectedValueOnce(new Error('runtime unavailable'));
    mocks.updateOperationRecord.mockResolvedValueOnce(createOperationRecord('failed'));

    await expect(stopProjectForPrincipal(createLifecycleInput())).rejects.toMatchObject({
      code: 'project_lifecycle_runtime_stop_failed',
    });
    expect(mocks.markDeploymentStopped).not.toHaveBeenCalled();
    expect(mocks.updateOperationRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'op_stop',
        status: 'failed',
      }),
    );
  });

  it('treats stopping an already stopped project as an idempotent no-op', async (): Promise<void> => {
    const stoppedDeployment: DeploymentJoinedRow = createDeployment('web', {
      isActive: false,
      promotionStage: 'stopped',
      status: 'stopped',
    });
    mockLifecycleContext([stoppedDeployment], []);

    const result: ProjectLifecycleResult = await stopProjectForPrincipal(createLifecycleInput());

    expect(result.state).toBe('stopped');
    expect(mocks.stopNodeDeployment).not.toHaveBeenCalled();
    expect(mocks.markDeploymentStopped).not.toHaveBeenCalled();
  });

  it('blocks lifecycle actions while deployments are updating', async (): Promise<void> => {
    mockLifecycleContext(
      [
        createDeployment('web', {
          health: 'pending',
          isActive: false,
          promotionStage: 'building',
          status: 'queued',
        }),
      ],
      [],
    );

    await expect(stopProjectForPrincipal(createLifecycleInput())).rejects.toMatchObject({
      code: 'project_lifecycle_busy',
    });
  });

  it('blocks start when no reusable deployment exists', async (): Promise<void> => {
    mocks.resolveActiveProjectScope.mockResolvedValueOnce(createProjectScope());
    mocks.findEnvironmentByProjectAndName.mockResolvedValueOnce(undefined);

    await expect(startProjectForPrincipal(createLifecycleInput())).rejects.toMatchObject({
      code: 'project_not_startable',
    });
  });

  it('blocks start when the latest stopped deployment was cleaned', async (): Promise<void> => {
    mockLifecycleContext(
      [
        createDeployment('web', {
          isActive: false,
          promotionStage: 'stopped',
          status: 'stopped',
        }),
      ].map(
        (deployment: DeploymentJoinedRow): DeploymentJoinedRow => ({
          ...deployment,
          artifact: {
            ...deployment.artifact,
            imageCleanedAt: new Date('2026-04-21T09:05:00.000Z'),
            imageRetentionState: 'cleaned',
          },
        }),
      ),
      [],
    );

    await expect(startProjectForPrincipal(createLifecycleInput())).rejects.toMatchObject({
      code: 'project_not_startable',
    });
  });

  it('does not repair projects that need attention', async (): Promise<void> => {
    mockLifecycleContext(
      [
        createDeployment('web', {
          failureMessage: 'Container crashed.',
          health: 'unhealthy',
          isActive: false,
          promotionStage: 'rolled_back',
          status: 'failed',
        }),
      ],
      [],
    );

    await expect(startProjectForPrincipal(createLifecycleInput())).rejects.toMatchObject({
      code: 'project_lifecycle_not_available',
    });
  });
});

function mockLifecycleContext(deployments: DeploymentJoinedRow[], activeDeployments: DeploymentJoinedRow[]): void {
  mocks.getApiConfig.mockReturnValue({
    baseDomain: 'localhost',
    bindHost: '127.0.0.1',
    caddyTlsMode: 'internal',
    customTlsDirectory: '/etc/compartment/tls',
    controlPlaneHost: 'console.localhost',
    databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
    edgeToken: 'edge-token',
    edgeUrl: 'http://127.0.0.1:9081',
    logLevel: 'silent',
    port: 9453,
    publicHttpPort: 9080,
    publicHttpsPort: 9443,
    publicProtocol: 'http',
    auditRetentionDays: 90,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    auditFileSink: defaultAuditFileSinkConfig,
    rollbackRetentionLimit: null,
    runtimeDefaultUpstreamHost: '127.0.0.1',
    sessionSecret: 'session-secret',
    sessionTtlMs: 86_400_000,
    sourceArchiveDirectory: '/tmp/compartment-source-archive',
    resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
    sourceArchiveMaxBytes: 1024,
    throttle: defaultApiAuthThrottleConfig,
    nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
    systemApiSocketPath: '/tmp/compartment/compartment-system.sock',
    systemToken: 'system-token',
    trustedOutboundHosts: [],
    variablesMasterKey: Buffer.alloc(32, 1),
    runtimeControlToken: 'worker-token',
  });
  mocks.resolveActiveProjectScope.mockResolvedValueOnce(createProjectScope());
  mocks.findEnvironmentByProjectAndName.mockResolvedValueOnce(createEnvironment());
  mocks.listJoinedDeploymentsForEnvironment.mockResolvedValueOnce(deployments);
  mocks.listActiveJoinedDeploymentsForEnvironment.mockResolvedValueOnce(activeDeployments);
}

function createLifecycleInput(): ProjectLifecycleInput {
  return {
    environmentName: 'production',
    organizationSlug: 'acme-dev',
    principalId: 'prn_123',
    projectName: 'billing',
  };
}

function createProjectScope(): ResolvedProjectScope {
  return {
    organization: {
      id: 'org_123',
      name: 'Acme Dev',
      slug: 'acme-dev',
    },
    project: createProject(),
  };
}

function createProject(): ProjectRow {
  return {
    archivedAt: null,
    createdAt: new Date('2026-04-21T08:00:00.000Z'),
    id: 'prj_billing',
    name: 'billing',
    organizationId: 'org_123',
    updatedAt: new Date('2026-04-21T09:00:00.000Z'),
  };
}

function createEnvironment(): EnvironmentRow {
  return {
    createdAt: new Date('2026-04-21T08:00:00.000Z'),
    id: 'env_billing',
    name: 'production',
    nodeId: 'node_123',
    projectId: 'prj_billing',
    updatedAt: new Date('2026-04-21T09:00:00.000Z'),
  };
}

function createNode(): NodeRow {
  return {
    createdAt: new Date('2026-04-21T08:00:00.000Z'),
    id: 'node_123',
    name: 'local',
    nodeSocketPath: '/tmp/compartment/api-test/node/project-lifecycle.sock',
    nodeVersion: '0.1.0',
    updatedAt: new Date('2026-04-21T08:00:00.000Z'),
  };
}

function createOperationRecord(status: OperationStatus): OperationRecord {
  return {
    actorPrincipalId: 'prn_123',
    completedAt: status === 'running' ? null : new Date('2026-04-21T09:00:00.000Z'),
    createdAt: new Date('2026-04-21T08:00:00.000Z'),
    id: 'op_stop',
    status,
    summary: 'deployment.stop',
    targetId: 'env_billing',
    targetType: 'environment',
    type: 'deployment.stop',
  };
}

function createNodeRequesterMock(): NodeRequester {
  return async (): Promise<never> =>
    await Promise.reject(new Error('Node requester should not be called directly in this unit test.'));
}

function createDeployment(serviceName: string, overrides?: Partial<DeploymentRow>): DeploymentJoinedRow {
  const createdAt: Date = new Date('2026-04-21T08:00:00.000Z');
  const deploymentId: string = `dep_${serviceName}`;

  return {
    artifact: {
      createdAt,
      createdByPrincipalId: 'prn_123',
      id: `art_${serviceName}`,
      imageRef: 'registry.example/billing:latest',
      imageRepository: 'registry.example/billing',
      imageRetentionState: 'available',
      imageCleanedAt: null,
      projectId: 'prj_billing',
      projectServiceId: `svc_${serviceName}`,
      resolvedBuildEnvJson: '{}',
      resolvedBuildJson: '{}',
      sourceDigest: 'sha256:123',
      sourceUploadId: null,
      updatedAt: createdAt,
    },
    deployment: {
      accessMode: 'authenticated',
      buildArtifactId: `art_${serviceName}`,
      completedAt: createdAt,
      containerId: `ctr_${deploymentId}`,
      createdAt,
      deploymentRunId: `drn_${deploymentId}`,
      drainDeadlineAt: null,
      drainingContainerId: null,
      drainingDeploymentId: null,
      drainingNodeId: null,
      environmentId: 'env_billing',
      failureMessage: null,
      health: 'healthy',
      id: deploymentId,
      isActive: true,
      movementSourceDeploymentId: null,
      label: null,
      nodeId: 'node_123',
      operationId: `op_${deploymentId}`,
      projectServiceId: `svc_${serviceName}`,
      promotionStage: 'active',
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
      routeBaseDomain: 'localhost',
      routeHost: 'billing.apps.localhost',
      status: 'succeeded',
      upstreamHost: '127.0.0.1',
      upstreamPort: 32000,
      updatedAt: createdAt,
      ...overrides,
    },
    environment: createEnvironment(),
    operation: {
      actorPrincipalId: 'prn_123',
      completedAt: createdAt,
      createdAt,
      id: `op_${deploymentId}`,
      status: 'succeeded',
      summary: 'deployment.run',
      targetId: 'env_billing',
      targetType: 'environment',
      type: 'deployment.run',
    },
    project: createProject(),
    service: {
      createdAt,
      id: `svc_${serviceName}`,
      kind: 'web',
      name: serviceName,
      path: `services/${serviceName}`,
      projectId: 'prj_billing',
      updatedAt: createdAt,
    },
  };
}
