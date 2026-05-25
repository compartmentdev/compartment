import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { WorkerCompleteDeploymentRequest } from '@compartment/contracts';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import type { Database } from '../src/db/client';
import type { createId } from '../src/lib/tokens';
import type { completeDeploymentWithRoute } from '../src/queries/deployment-completion.query';
import type { DeploymentJoinedRow, DeploymentRow } from '../src/queries/deployments.query.types';
import type { OperationRecord } from '../src/queries/operations.query.types';
import type { ProjectRow } from '../src/queries/projects.query.types';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import { persistCompletedDeployment } from '../src/services/deployment-completion.service';
import type { synchronizeEdgeAppAccessState } from '../src/services/app-access-edge.service';

type CompleteDeploymentWithRoute = typeof completeDeploymentWithRoute;
type CreateId = typeof createId;
type SynchronizeEdgeAppAccessState = typeof synchronizeEdgeAppAccessState;
type DeploymentRowOverrides = Partial<DeploymentRow>;
const defaultResolvedRunJson: string = JSON.stringify({
  restart: {
    policy: 'on-failure',
  },
});

interface DeploymentCompletionServiceMocks {
  completeDeploymentWithRoute: Mock<CompleteDeploymentWithRoute>;
  createId: Mock<CreateId>;
  synchronizeEdgeAppAccessState: Mock<SynchronizeEdgeAppAccessState>;
}

const mocks: DeploymentCompletionServiceMocks = vi.hoisted(
  (): DeploymentCompletionServiceMocks => ({
    completeDeploymentWithRoute: vi.fn<CompleteDeploymentWithRoute>(),
    createId: vi.fn<CreateId>(),
    synchronizeEdgeAppAccessState: vi.fn<SynchronizeEdgeAppAccessState>(),
  }),
);

vi.mock(
  '../src/queries/deployment-completion.query',
  (): { completeDeploymentWithRoute: Mock<CompleteDeploymentWithRoute> } => ({
    completeDeploymentWithRoute: mocks.completeDeploymentWithRoute,
  }),
);

vi.mock('../src/lib/tokens', (): { createId: Mock<CreateId> } => ({
  createId: mocks.createId,
}));

vi.mock(
  '../src/services/app-access-edge.service',
  (): { synchronizeEdgeAppAccessState: Mock<SynchronizeEdgeAppAccessState> } => ({
    synchronizeEdgeAppAccessState: mocks.synchronizeEdgeAppAccessState,
  }),
);

const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  caddyTlsMode: 'internal',
  customTlsDirectory: '/etc/compartment/tls',
  controlPlaneHost: 'console.localhost',
  databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9080',
  logLevel: 'silent',
  port: 9443,
  publicProtocol: 'http',
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  publicHttpPort: 9080,
  publicHttpsPort: 443,
  sessionSecret: 'test-session-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  runtimeDefaultUpstreamHost: '127.0.0.1',
  nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
  systemApiSocketPath: '/tmp/compartment/compartment-deployment-completion-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
  runtimeControlToken: 'test-runtime-control-token',
};

describe('deployment completion service', (): void => {
  beforeEach((): void => {
    configureApiRuntime({
      config: apiConfig,
      db: {} as Database,
    });
    mocks.completeDeploymentWithRoute.mockResolvedValue();
    mocks.createId.mockReturnValue('rte_123');
    mocks.synchronizeEdgeAppAccessState.mockResolvedValue();
  });

  afterEach((): void => {
    clearApiRuntime();
  });

  it('persists the runtime route for completed deployments', async (): Promise<void> => {
    await expect(
      persistCompletedDeployment(createDeploymentJoinedRow(), createWorkerCompleteDeploymentRequest()),
    ).resolves.toEqual([]);

    expect(mocks.completeDeploymentWithRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        buildArtifactId: 'art_123',
        deploymentId: 'dep_123',
        operationId: 'op_123',
        routeHost: 'runtime-web.localhost',
        routeId: 'rte_123',
        upstreamHost: '127.0.0.1',
        upstreamPort: 31000,
        routeSubdomain: 'runtime-web',
        serviceId: 'svc_123',
      }),
    );
  });

  it('persists the runtime route and preserves edge sync failures', async (): Promise<void> => {
    mocks.synchronizeEdgeAppAccessState.mockRejectedValueOnce(new Error('edge sync failed'));

    await expect(
      persistCompletedDeployment(createDeploymentJoinedRow(), createWorkerCompleteDeploymentRequest()),
    ).rejects.toThrow('edge sync failed');

    expect(mocks.completeDeploymentWithRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        buildArtifactId: 'art_123',
        deploymentId: 'dep_123',
        operationId: 'op_123',
        routeHost: 'runtime-web.localhost',
        routeId: 'rte_123',
        upstreamHost: '127.0.0.1',
        upstreamPort: 31000,
        routeSubdomain: 'runtime-web',
        serviceId: 'svc_123',
      }),
    );
  });
});

function createWorkerCompleteDeploymentRequest(): WorkerCompleteDeploymentRequest {
  return {
    containerId: 'container_123',
    deploymentId: 'dep_123',
    imageRef: 'sha256:image',
    routeHost: 'runtime-web.localhost',
    upstreamHost: '127.0.0.1',
    upstreamPort: 31000,
  };
}

function createDeploymentJoinedRow(overrides: DeploymentRowOverrides = {}): DeploymentJoinedRow {
  const project: ProjectRow = {
    archivedAt: null,
    createdAt: new Date('2026-03-24T00:00:00.000Z'),
    id: 'prj_123',
    name: 'billing',
    organizationId: 'org_123',
    updatedAt: new Date('2026-03-24T00:00:00.000Z'),
  };

  return {
    artifact: {
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      createdByPrincipalId: null,
      id: 'art_123',
      imageRef: null,
      imageRepository: 'compartment/projects/prj_123/services/svc_123',
      imageRetentionState: 'available',
      imageCleanedAt: null,
      projectId: project.id,
      projectServiceId: 'svc_123',
      resolvedBuildJson: '{"env":[],"packages":{"build":[],"runtime":[]},"strategy":"auto"}',
      resolvedBuildEnvJson: '{}',
      sourceDigest: 'sha256:test',
      sourceUploadId: 'sup_123',
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    deployment: {
      accessMode: 'authenticated',
      buildArtifactId: 'art_123',
      completedAt: null,
      containerId: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      deploymentRunId: 'drn_123',
      drainDeadlineAt: null,
      drainingContainerId: null,
      drainingDeploymentId: null,
      drainingNodeId: null,
      environmentId: 'env_123',
      failureMessage: null,
      health: 'pending',
      id: 'dep_123',
      isActive: false,
      movementSourceDeploymentId: null,
      label: null,
      nodeId: 'node_123',
      operationId: 'op_123',
      promotionStage: 'building',
      projectServiceId: 'svc_123',
      resolvedReadinessJson: '{"type":"http","path":"/healthz","timeoutMs":30000}',
      resolvedReleaseJson: 'null',
      resolvedRunJson: defaultResolvedRunJson,
      resolvedRoutesJson: '[]',
      sourceAutomationPrincipalId: null,
      sourceBindingId: null,
      sourceBindingSnapshotJson: null,
      sourceCommitSha: null,
      sourceEventId: null,
      sourceId: null,
      sourceKind: null,
      sourceRepositorySnapshotJson: null,
      sourceResolutionTaskId: null,
      routeBaseDomain: null,
      routeHost: null,
      upstreamHost: null,
      upstreamPort: null,
      status: 'running',
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
      ...overrides,
    },
    environment: {
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      id: 'env_123',
      name: 'production',
      nodeId: 'node_123',
      projectId: project.id,
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    operation: createOperationRecord(),
    project,
    service: {
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      id: 'svc_123',
      kind: 'web',
      name: 'web',
      path: '.',
      projectId: project.id,
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  };
}

function createOperationRecord(): OperationRecord {
  return {
    actorPrincipalId: 'prn_123',
    completedAt: null,
    createdAt: new Date('2026-03-24T00:00:00.000Z'),
    id: 'op_123',
    status: 'running',
    summary: 'Deploying billing',
    targetId: 'dep_123',
    targetType: 'deployment',
    type: 'deployment.deploy',
  };
}
