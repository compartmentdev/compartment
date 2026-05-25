import type { NodeInspectDeploymentQuery, WorkerArtifactCleanupTarget } from '@compartment/contracts';
import type { NodeRequester, drainNodeDeployment, inspectNodeDeployment } from '@compartment/sdk';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import type { findActiveJoinedDeployment, findJoinedDeploymentById } from '../src/queries/deployment-joined.query';
import type {
  listOrphanedRunningDeployments,
  listPendingDrainDeployments,
} from '../src/queries/deployment-recovery.query';
import type { findNodeById } from '../src/queries/node.query';
import type { updateDeploymentRuntimeState } from '../src/queries/deployments.query';
import { recoverOrphanedRunningDeploymentsForWorker } from '../src/services/deployment-worker.service';
import type {
  DeploymentJoinedRow,
  DeploymentRow,
  UpdateDeploymentRuntimeStateInput,
} from '../src/queries/deployments.query.types';
import type { NodeRow } from '../src/queries/node.query.types';
import type { OperationRecord } from '../src/queries/operations.query.types';
import type { getApiConfig } from '../src/runtime/runtime-access';
import type { requireJoinedDeployment, requireNode } from '../src/services/deployment-context.service';
import type {
  appendRuntimeEvent,
  finalizeCompletedDeployment,
  finalizeFailedDeployment,
} from '../src/services/deployment-worker-finalization.service';
import type { createNodeRuntimeRequester } from '../src/services/node-runtime-requester';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import type { Database } from '../src/db/client';

type CreateNodeRuntimeRequester = typeof createNodeRuntimeRequester;
type AppendRuntimeEvent = typeof appendRuntimeEvent;
type FinalizeCompletedDeployment = typeof finalizeCompletedDeployment;
type FinalizeFailedDeployment = typeof finalizeFailedDeployment;
type FindActiveJoinedDeployment = typeof findActiveJoinedDeployment;
type FindJoinedDeploymentById = typeof findJoinedDeploymentById;
type FindNodeById = typeof findNodeById;
type GetApiConfig = typeof getApiConfig;
type DrainNodeDeployment = typeof drainNodeDeployment;
type InspectNodeDeployment = typeof inspectNodeDeployment;
type ListOrphanedRunningDeployments = typeof listOrphanedRunningDeployments;
type ListPendingDrainDeployments = typeof listPendingDrainDeployments;
type RequireJoinedDeployment = typeof requireJoinedDeployment;
type RequireNode = typeof requireNode;
type UpdateDeploymentRuntimeState = typeof updateDeploymentRuntimeState;
type DeploymentRowOverrides = Partial<DeploymentRow>;
type UpdateDeploymentRuntimeCall = UpdateDeploymentRuntimeStateInput;
const defaultResolvedRunJson: string = JSON.stringify({
  restart: {
    policy: 'on-failure',
  },
});

interface DeploymentWorkerServiceMocks {
  appendDeploymentRunEvent: Mock<() => Promise<void>>;
  appendRuntimeEvent: Mock<AppendRuntimeEvent>;
  createNodeRuntimeRequester: Mock<CreateNodeRuntimeRequester>;
  drainNodeDeployment: Mock<DrainNodeDeployment>;
  finalizeCompletedDeployment: Mock<FinalizeCompletedDeployment>;
  finalizeFailedDeployment: Mock<FinalizeFailedDeployment>;
  findActiveJoinedDeployment: Mock<FindActiveJoinedDeployment>;
  findJoinedDeploymentById: Mock<FindJoinedDeploymentById>;
  findNodeById: Mock<FindNodeById>;
  getApiConfig: Mock<GetApiConfig>;
  inspectNodeDeployment: Mock<InspectNodeDeployment>;
  listOrphanedRunningDeployments: Mock<ListOrphanedRunningDeployments>;
  listPendingDrainDeployments: Mock<ListPendingDrainDeployments>;
  requireJoinedDeployment: Mock<RequireJoinedDeployment>;
  requireNode: Mock<RequireNode>;
  updateDeploymentRuntimeState: Mock<UpdateDeploymentRuntimeState>;
}

interface DeploymentJoinedQueryMockModule {
  findActiveJoinedDeployment: Mock<FindActiveJoinedDeployment>;
  findJoinedDeploymentById: Mock<FindJoinedDeploymentById>;
}

interface DeploymentRecoveryQueryMockModule {
  listOrphanedRunningDeployments: Mock<ListOrphanedRunningDeployments>;
  listPendingDrainDeployments: Mock<ListPendingDrainDeployments>;
}

interface NodeQueryMockModule {
  findNodeById: Mock<FindNodeById>;
}

interface NodeRuntimeRequesterMockModule {
  createNodeRuntimeRequester: Mock<CreateNodeRuntimeRequester>;
}

interface RuntimeAccessMockModule {
  getApiConfig: Mock<GetApiConfig>;
}

interface SdkMockModule {
  drainNodeDeployment: Mock<DrainNodeDeployment>;
  inspectNodeDeployment: Mock<InspectNodeDeployment>;
}

interface DeploymentContextServiceMockModule {
  requireJoinedDeployment: Mock<RequireJoinedDeployment>;
  requireNode: Mock<RequireNode>;
}

interface DeploymentWorkerFinalizationServiceMockModule {
  appendRuntimeEvent: Mock<AppendRuntimeEvent>;
  finalizeCompletedDeployment: Mock<FinalizeCompletedDeployment>;
  finalizeFailedDeployment: Mock<FinalizeFailedDeployment>;
}

const nodeRuntimeRequester: NodeRequester = vi.fn() as NodeRequester;
const apiConfig: ApiConfig = {
  bindHost: '127.0.0.1',
  baseDomain: 'localhost',
  caddyTlsMode: 'internal',
  customTlsDirectory: '/etc/compartment/tls',
  controlPlaneHost: 'console.localhost',
  databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9444,
  publicProtocol: 'http',
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  publicHttpPort: 80,
  publicHttpsPort: 443,
  runtimeDefaultUpstreamHost: '127.0.0.1',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-api-test-source-archives',
  resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
  systemApiSocketPath: '/tmp/compartment/compartment-worker-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
  runtimeControlToken: 'test-runtime-control-token',
};

const mocks: DeploymentWorkerServiceMocks = vi.hoisted(
  (): DeploymentWorkerServiceMocks => ({
    appendDeploymentRunEvent: vi.fn(),
    appendRuntimeEvent: vi.fn<AppendRuntimeEvent>(),
    createNodeRuntimeRequester: vi.fn<CreateNodeRuntimeRequester>(),
    drainNodeDeployment: vi.fn<DrainNodeDeployment>(),
    finalizeCompletedDeployment: vi.fn<FinalizeCompletedDeployment>(),
    finalizeFailedDeployment: vi.fn<FinalizeFailedDeployment>(),
    findActiveJoinedDeployment: vi.fn<FindActiveJoinedDeployment>(),
    findJoinedDeploymentById: vi.fn<FindJoinedDeploymentById>(),
    findNodeById: vi.fn<FindNodeById>(),
    getApiConfig: vi.fn<GetApiConfig>(),
    inspectNodeDeployment: vi.fn<InspectNodeDeployment>(),
    listOrphanedRunningDeployments: vi.fn<ListOrphanedRunningDeployments>(),
    listPendingDrainDeployments: vi.fn<ListPendingDrainDeployments>(),
    requireJoinedDeployment: vi.fn<RequireJoinedDeployment>(),
    requireNode: vi.fn<RequireNode>(),
    updateDeploymentRuntimeState: vi.fn<UpdateDeploymentRuntimeState>(),
  }),
);

vi.mock(
  '../src/runtime/runtime-access',
  (): RuntimeAccessMockModule => ({
    getApiConfig: mocks.getApiConfig,
  }),
);

vi.mock(
  '../src/queries/deployment-joined.query',
  (): DeploymentJoinedQueryMockModule => ({
    findActiveJoinedDeployment: mocks.findActiveJoinedDeployment,
    findJoinedDeploymentById: mocks.findJoinedDeploymentById,
  }),
);

vi.mock(
  '../src/queries/deployment-recovery.query',
  (): DeploymentRecoveryQueryMockModule => ({
    listOrphanedRunningDeployments: mocks.listOrphanedRunningDeployments,
    listPendingDrainDeployments: mocks.listPendingDrainDeployments,
  }),
);

vi.mock(
  '../src/queries/node.query',
  (): NodeQueryMockModule => ({
    findNodeById: mocks.findNodeById,
  }),
);

vi.mock(
  '../src/services/node-runtime-requester',
  (): NodeRuntimeRequesterMockModule => ({
    createNodeRuntimeRequester: mocks.createNodeRuntimeRequester,
  }),
);

vi.mock(
  '@compartment/sdk',
  (): SdkMockModule => ({
    drainNodeDeployment: mocks.drainNodeDeployment,
    inspectNodeDeployment: mocks.inspectNodeDeployment,
  }),
);

vi.mock(
  '../src/services/deployment-context.service',
  (): DeploymentContextServiceMockModule => ({
    requireJoinedDeployment: mocks.requireJoinedDeployment,
    requireNode: mocks.requireNode,
  }),
);

vi.mock(
  '../src/services/deployment-worker-finalization.service',
  (): DeploymentWorkerFinalizationServiceMockModule => ({
    appendRuntimeEvent: mocks.appendRuntimeEvent,
    finalizeCompletedDeployment: mocks.finalizeCompletedDeployment,
    finalizeFailedDeployment: mocks.finalizeFailedDeployment,
  }),
);

vi.mock('../src/queries/deployment-run-events.query', (): { appendDeploymentRunEvent: Mock<() => Promise<void>> } => ({
  appendDeploymentRunEvent: mocks.appendDeploymentRunEvent,
}));

vi.mock(
  '../src/queries/deployments.query',
  (): {
    updateDeploymentRuntimeState: Mock<UpdateDeploymentRuntimeState>;
  } => ({
    updateDeploymentRuntimeState: mocks.updateDeploymentRuntimeState,
  }),
);

describe('deployment worker service', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    configureApiRuntime({
      config: apiConfig,
      db: {} as Database,
    });
    mocks.listOrphanedRunningDeployments.mockResolvedValue([{ id: 'dep_first' }, { id: 'dep_second' }]);
    mocks.listPendingDrainDeployments.mockResolvedValue([]);
    mocks.appendRuntimeEvent.mockResolvedValue(undefined);
    mocks.createNodeRuntimeRequester.mockReturnValue(nodeRuntimeRequester);
    mocks.finalizeCompletedDeployment.mockResolvedValue([]);
    mocks.finalizeFailedDeployment.mockResolvedValue(undefined);
    mocks.findActiveJoinedDeployment.mockResolvedValue(undefined);
    mocks.findJoinedDeploymentById.mockImplementation(readJoinedDeploymentById);
    mocks.findNodeById.mockImplementation(readNodeById);
    mocks.getApiConfig.mockReturnValue(apiConfig);
    mocks.requireJoinedDeployment.mockImplementation(readRequiredJoinedDeployment);
    mocks.requireNode.mockImplementation(readRequiredNode);
  });

  afterEach((): void => {
    clearApiRuntime();
  });

  it('continues recovering later orphaned deployments after an earlier runtime inspect failure', async (): Promise<void> => {
    const firstError: Error = new Error('first inspect failure');
    const secondError: Error = new Error('second inspect failure');
    mocks.inspectNodeDeployment.mockRejectedValueOnce(firstError).mockRejectedValueOnce(secondError);

    await expect(recoverOrphanedRunningDeploymentsForWorker('all')).rejects.toThrow('first inspect failure');

    expect(mocks.inspectNodeDeployment).toHaveBeenCalledTimes(2);
    expect(
      mocks.inspectNodeDeployment.mock.calls.map(
        ([, input]: [NodeRequester, NodeInspectDeploymentQuery]): string => input.deploymentId,
      ),
    ).toEqual(['dep_first', 'dep_second']);
  });

  it('recovers a pending drain deployment by draining the previous container on its persisted owner node', async (): Promise<void> => {
    mocks.listOrphanedRunningDeployments.mockResolvedValueOnce([]);
    mocks.listPendingDrainDeployments.mockResolvedValueOnce([{ id: 'dep_pending' }]);
    mocks.findJoinedDeploymentById.mockImplementation(async (deploymentId: string): Promise<DeploymentJoinedRow> => {
      if (deploymentId === 'dep_pending') {
        return await Promise.resolve(
          createDeploymentJoinedRow('dep_pending', {
            containerId: 'candidate_container_123',
            drainDeadlineAt: new Date('2026-03-24T10:00:05.000Z'),
            drainingContainerId: 'legacy_container_123',
            drainingDeploymentId: 'dep_previous',
            drainingNodeId: 'node_drain',
            isActive: false,
            nodeId: 'node_current',
            promotionStage: 'draining_previous',
            upstreamPort: 31001,
            status: 'succeeded',
          }),
        );
      }

      return await readJoinedDeploymentById(deploymentId);
    });
    mocks.drainNodeDeployment.mockResolvedValueOnce({
      acceptedAt: '2026-03-24T10:00:05.000Z',
    });
    mocks.updateDeploymentRuntimeState.mockResolvedValueOnce(
      createDeploymentJoinedRow('dep_pending', {
        containerId: 'candidate_container_123',
        drainDeadlineAt: null,
        drainingContainerId: null,
        drainingDeploymentId: null,
        drainingNodeId: null,
        isActive: false,
        nodeId: 'node_current',
        promotionStage: 'active',
        upstreamPort: 31001,
        status: 'succeeded',
      }).deployment,
    );

    await expect(recoverOrphanedRunningDeploymentsForWorker('all')).resolves.toEqual({
      cleanupArtifacts: [],
      recoveredDeploymentCount: 1,
    });

    expect(mocks.createNodeRuntimeRequester).toHaveBeenCalledWith('/tmp/compartment/api-test/node/drain.sock');
    expect(mocks.drainNodeDeployment.mock.calls[0]?.[1]).toEqual({
      containerId: 'legacy_container_123',
      deploymentId: 'dep_previous',
      drainDeadlineAt: '2026-03-24T10:00:05.000Z',
    });
    const updateInput: UpdateDeploymentRuntimeCall | undefined = mocks.updateDeploymentRuntimeState.mock.calls[0]?.[0];

    expect(updateInput).toMatchObject({
      containerId: 'candidate_container_123',
      deploymentId: 'dep_pending',
      drainDeadlineAt: null,
      drainingContainerId: null,
      drainingDeploymentId: null,
      drainingNodeId: null,
      promotionStage: 'active',
      upstreamHost: '127.0.0.1',
      upstreamPort: 31001,
    });
    expect(updateInput?.updatedAt).toBeInstanceOf(Date);
  });

  it('returns recovered cleanup artifacts from finalized live deployments', async (): Promise<void> => {
    const cleanupArtifacts: WorkerArtifactCleanupTarget[] = [
      {
        imageRef: 'registry.example/compartment/projects/prj_123/services/svc_123@sha256:abc',
      },
    ];

    mocks.listOrphanedRunningDeployments.mockResolvedValueOnce([{ id: 'dep_recovered' }]);
    mocks.inspectNodeDeployment.mockResolvedValueOnce({
      deployment: {
        containerId: 'container_123',
        imageRef: 'sha256:image',
        routeHost: 'smoke-web.localhost',
        upstreamHost: '127.0.0.1',
        upstreamPort: 31000,
      },
    });
    mocks.finalizeCompletedDeployment.mockResolvedValueOnce(cleanupArtifacts);

    await expect(recoverOrphanedRunningDeploymentsForWorker('all')).resolves.toEqual({
      cleanupArtifacts,
      recoveredDeploymentCount: 1,
    });
    expect(mocks.finalizeCompletedDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 'dep_recovered',
      }),
    );
  });
});

async function readJoinedDeploymentById(deploymentId: string): Promise<DeploymentJoinedRow> {
  return await Promise.resolve(createDeploymentJoinedRow(deploymentId));
}

function readRequiredJoinedDeployment(input: DeploymentJoinedRow | undefined): DeploymentJoinedRow {
  if (input === undefined) {
    throw new Error('Expected deployment.');
  }

  return input;
}

function readRequiredNode(input: NodeRow | undefined): NodeRow {
  if (input === undefined) {
    throw new Error('Expected node.');
  }

  return input;
}

async function readNodeById(nodeId: string): Promise<NodeRow> {
  if (nodeId === 'node_drain') {
    return await Promise.resolve(
      createNodeRow({
        id: 'node_drain',
        nodeSocketPath: '/tmp/compartment/api-test/node/drain.sock',
      }),
    );
  }

  return await Promise.resolve(createNodeRow({ id: nodeId }));
}

function createNodeRow(input: Partial<NodeRow> = {}): NodeRow {
  return {
    createdAt: new Date('2026-03-24T00:00:00.000Z'),
    id: 'node_123',
    name: 'local-node',
    nodeSocketPath: '/tmp/compartment/api-test/node/local.sock',
    nodeVersion: '0.1.0',
    updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    ...input,
  };
}

function createDeploymentJoinedRow(deploymentId: string, overrides: DeploymentRowOverrides = {}): DeploymentJoinedRow {
  return {
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
      id: deploymentId,
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
      projectId: 'prj_123',
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    operation: createOperationRecord(),
    project: {
      archivedAt: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      id: 'prj_123',
      name: 'billing',
      organizationId: 'org_123',
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    artifact: {
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      createdByPrincipalId: null,
      id: 'art_123',
      imageRepository: 'compartment/projects/prj_123/services/svc_123',
      imageRef: null,
      imageRetentionState: 'available',
      imageCleanedAt: null,
      projectId: 'prj_123',
      projectServiceId: 'svc_123',
      resolvedBuildJson: '{"env":[],"packages":{"build":[],"runtime":[]},"strategy":"auto"}',
      resolvedBuildEnvJson: '{}',
      sourceDigest: 'sha256:test',
      sourceUploadId: null,
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    service: {
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      id: 'svc_123',
      kind: 'web',
      name: 'web',
      path: '.',
      projectId: 'prj_123',
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
