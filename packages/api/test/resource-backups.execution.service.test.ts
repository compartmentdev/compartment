import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NodeResourceOperationResponse, ResourceBackupStatus } from '@compartment/contracts';
import type { Database } from '../src/db/client';
import type { EnvironmentRow } from '../src/queries/deployments.query.types';
import type { OperationRecord, UpdateOperationInput } from '../src/queries/operations.query.types';
import type {
  insertOperationRecordWithExecutor,
  updateOperationRecordWithExecutor,
} from '../src/queries/operations.query';
import type {
  completeResourceBackupWithExecutor,
  createResourceBackupWithExecutor,
  failResourceBackupWithExecutor,
} from '../src/queries/resource-backups.query';
import type {
  CreateResourceBackupInput,
  FailResourceBackupInput,
  ResourceBackupRow,
} from '../src/queries/resource-backups.query.types';
import type { OrganizationRow } from '../src/queries/organizations.query.types';
import type { ProjectRow } from '../src/queries/projects.query.types';
import type { ProjectResourceRow, ResourceTransaction } from '../src/queries/resources.query.types';
import type { getApiDatabase } from '../src/runtime/runtime-access';
import type {
  prepareResourceBackupArtifactDirectory,
  summarizeResourceBackupArtifact,
} from '../src/services/resource-backup-artifact.service';
import type {
  buildResourceOperationRequest,
  requireBackupArtifactId,
  resolveBackupOperationContext,
  resolveResourceOperationContext,
  resolveRestoreOperationContext,
  ResourceBackupOperationContext,
} from '../src/services/resource-backups.operation-context.service';
import { runResourceBackup } from '../src/services/resource-backups.execution.service';
import type { RunResourceBackupInput } from '../src/services/resources.service.types';

type BuildResourceOperationRequest = typeof buildResourceOperationRequest;
type CompleteResourceBackupWithExecutor = typeof completeResourceBackupWithExecutor;
type CreateResourceBackupWithExecutor = typeof createResourceBackupWithExecutor;
type FailResourceBackupWithExecutor = typeof failResourceBackupWithExecutor;
type GetApiDatabase = typeof getApiDatabase;
type InsertOperationRecordWithExecutor = typeof insertOperationRecordWithExecutor;
type PrepareResourceBackupArtifactDirectory = typeof prepareResourceBackupArtifactDirectory;
type RequireBackupArtifactId = typeof requireBackupArtifactId;
type ResolveBackupOperationContext = typeof resolveBackupOperationContext;
type ResolveResourceOperationContext = typeof resolveResourceOperationContext;
type ResolveRestoreOperationContext = typeof resolveRestoreOperationContext;
type SummarizeResourceBackupArtifact = typeof summarizeResourceBackupArtifact;
type UpdateOperationRecordWithExecutor = typeof updateOperationRecordWithExecutor;

interface ResourceBackupExecutionMocks {
  buildResourceOperationRequest: Mock<BuildResourceOperationRequest>;
  completeResourceBackupWithExecutor: Mock<CompleteResourceBackupWithExecutor>;
  createResourceBackupWithExecutor: Mock<CreateResourceBackupWithExecutor>;
  failResourceBackupWithExecutor: Mock<FailResourceBackupWithExecutor>;
  getApiDatabase: Mock<GetApiDatabase>;
  insertOperationRecordWithExecutor: Mock<InsertOperationRecordWithExecutor>;
  prepareResourceBackupArtifactDirectory: Mock<PrepareResourceBackupArtifactDirectory>;
  requireBackupArtifactId: Mock<RequireBackupArtifactId>;
  resolveBackupOperationContext: Mock<ResolveBackupOperationContext>;
  resolveResourceOperationContext: Mock<ResolveResourceOperationContext>;
  resolveRestoreOperationContext: Mock<ResolveRestoreOperationContext>;
  summarizeResourceBackupArtifact: Mock<SummarizeResourceBackupArtifact>;
  updateOperationRecordWithExecutor: Mock<UpdateOperationRecordWithExecutor>;
}

interface OperationsQueryMockModule {
  insertOperationRecordWithExecutor: Mock<InsertOperationRecordWithExecutor>;
  updateOperationRecordWithExecutor: Mock<UpdateOperationRecordWithExecutor>;
}

interface ResourceBackupsQueryMockModule {
  completeResourceBackupWithExecutor: Mock<CompleteResourceBackupWithExecutor>;
  createResourceBackupWithExecutor: Mock<CreateResourceBackupWithExecutor>;
  failResourceBackupWithExecutor: Mock<FailResourceBackupWithExecutor>;
}

interface RuntimeAccessMockModule {
  getApiDatabase: Mock<GetApiDatabase>;
}

interface ResourceBackupArtifactMockModule {
  prepareResourceBackupArtifactDirectory: Mock<PrepareResourceBackupArtifactDirectory>;
  summarizeResourceBackupArtifact: Mock<SummarizeResourceBackupArtifact>;
}

interface ResourceBackupOperationContextMockModule {
  buildResourceOperationRequest: Mock<BuildResourceOperationRequest>;
  requireBackupArtifactId: Mock<RequireBackupArtifactId>;
  resolveBackupOperationContext: Mock<ResolveBackupOperationContext>;
  resolveResourceOperationContext: Mock<ResolveResourceOperationContext>;
  resolveRestoreOperationContext: Mock<ResolveRestoreOperationContext>;
}

const mocks: ResourceBackupExecutionMocks = vi.hoisted(
  (): ResourceBackupExecutionMocks => ({
    buildResourceOperationRequest: vi.fn<BuildResourceOperationRequest>(),
    completeResourceBackupWithExecutor: vi.fn<CompleteResourceBackupWithExecutor>(),
    createResourceBackupWithExecutor: vi.fn<CreateResourceBackupWithExecutor>(),
    failResourceBackupWithExecutor: vi.fn<FailResourceBackupWithExecutor>(),
    getApiDatabase: vi.fn<GetApiDatabase>(),
    insertOperationRecordWithExecutor: vi.fn<InsertOperationRecordWithExecutor>(),
    prepareResourceBackupArtifactDirectory: vi.fn<PrepareResourceBackupArtifactDirectory>(),
    requireBackupArtifactId: vi.fn<RequireBackupArtifactId>(),
    resolveBackupOperationContext: vi.fn<ResolveBackupOperationContext>(),
    resolveResourceOperationContext: vi.fn<ResolveResourceOperationContext>(),
    resolveRestoreOperationContext: vi.fn<ResolveRestoreOperationContext>(),
    summarizeResourceBackupArtifact: vi.fn<SummarizeResourceBackupArtifact>(),
    updateOperationRecordWithExecutor: vi.fn<UpdateOperationRecordWithExecutor>(),
  }),
);

vi.mock(
  '../src/queries/operations.query',
  (): OperationsQueryMockModule => ({
    insertOperationRecordWithExecutor: mocks.insertOperationRecordWithExecutor,
    updateOperationRecordWithExecutor: mocks.updateOperationRecordWithExecutor,
  }),
);

vi.mock(
  '../src/queries/resource-backups.query',
  (): ResourceBackupsQueryMockModule => ({
    completeResourceBackupWithExecutor: mocks.completeResourceBackupWithExecutor,
    createResourceBackupWithExecutor: mocks.createResourceBackupWithExecutor,
    failResourceBackupWithExecutor: mocks.failResourceBackupWithExecutor,
  }),
);

vi.mock(
  '../src/runtime/runtime-access',
  (): RuntimeAccessMockModule => ({
    getApiDatabase: mocks.getApiDatabase,
  }),
);

vi.mock(
  '../src/services/resource-backup-artifact.service',
  (): ResourceBackupArtifactMockModule => ({
    prepareResourceBackupArtifactDirectory: mocks.prepareResourceBackupArtifactDirectory,
    summarizeResourceBackupArtifact: mocks.summarizeResourceBackupArtifact,
  }),
);

vi.mock(
  '../src/services/resource-backups.operation-context.service',
  (): ResourceBackupOperationContextMockModule => ({
    buildResourceOperationRequest: mocks.buildResourceOperationRequest,
    requireBackupArtifactId: mocks.requireBackupArtifactId,
    resolveBackupOperationContext: mocks.resolveBackupOperationContext,
    resolveResourceOperationContext: mocks.resolveResourceOperationContext,
    resolveRestoreOperationContext: mocks.resolveRestoreOperationContext,
  }),
);

interface SdkMockModule {
  runNodeResourceBackupOperation: () => Promise<NodeResourceOperationResponse>;
  runNodeResourceRestoreOperation: () => Promise<NodeResourceOperationResponse>;
}

vi.mock(
  '@compartment/sdk',
  (): SdkMockModule => ({
    runNodeResourceBackupOperation: async (): Promise<NodeResourceOperationResponse> =>
      await Promise.resolve({ stderr: '', stdout: '' }),
    runNodeResourceRestoreOperation: async (): Promise<NodeResourceOperationResponse> =>
      await Promise.resolve({ stderr: '', stdout: '' }),
  }),
);

describe('resource backup execution service', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.getApiDatabase.mockReturnValue(createMockDatabase());
    mocks.insertOperationRecordWithExecutor.mockResolvedValue(createOperationRecord());
    mocks.createResourceBackupWithExecutor.mockResolvedValue(createResourceBackupRow('running'));
    mocks.failResourceBackupWithExecutor.mockResolvedValue(createResourceBackupRow('failed'));
    mocks.resolveBackupOperationContext.mockResolvedValue({} as ResourceBackupOperationContext);
  });

  it('marks a running backup failed when artifact directory preparation fails', async (): Promise<void> => {
    mocks.prepareResourceBackupArtifactDirectory.mockRejectedValueOnce(new Error('backup directory unavailable'));

    await expect(runResourceBackup(createRunResourceBackupInput())).rejects.toThrow('backup directory unavailable');

    const createInput: CreateResourceBackupInput = readFirstCreateResourceBackupInput();
    const failInput: FailResourceBackupInput = readFirstFailResourceBackupInput();
    const operationInput: UpdateOperationInput = readFirstUpdateOperationInput();

    expect(createInput).toMatchObject({
      createdByPrincipalId: 'prn_admin',
      operationId: 'op_backup',
      projectResourceId: 'res_postgres',
      purpose: 'manual',
      status: 'running',
    });
    expect(createInput.id).toMatch(/^rbak_/u);
    expect(failInput).toMatchObject({
      backupId: 'rbak_test',
      failureSummary: 'backup directory unavailable',
      stderrSummary: '',
      stdoutSummary: '',
    });
    expect(failInput.completedAt).toBeInstanceOf(Date);
    expect(operationInput).toMatchObject({
      operationId: 'op_backup',
      status: 'failed',
      summary: 'backup directory unavailable',
    });
    expect(operationInput.completedAt).toBeInstanceOf(Date);
  });
});

class MockResourceBackupDatabase {
  async transaction<T>(runInTransaction: (tx: ResourceTransaction) => Promise<T>): Promise<T> {
    return await runInTransaction({} as ResourceTransaction);
  }
}

function createMockDatabase(): Database {
  return new MockResourceBackupDatabase() as Database;
}

function readFirstCreateResourceBackupInput(): CreateResourceBackupInput {
  const input: CreateResourceBackupInput | undefined = mocks.createResourceBackupWithExecutor.mock.calls[0]?.[1];
  expect(input).not.toBeUndefined();

  return input!;
}

function readFirstFailResourceBackupInput(): FailResourceBackupInput {
  const input: FailResourceBackupInput | undefined = mocks.failResourceBackupWithExecutor.mock.calls[0]?.[1];
  expect(input).not.toBeUndefined();

  return input!;
}

function readFirstUpdateOperationInput(): UpdateOperationInput {
  const input: UpdateOperationInput | undefined = mocks.updateOperationRecordWithExecutor.mock.calls[0]?.[1];
  expect(input).not.toBeUndefined();

  return input!;
}

function createRunResourceBackupInput(): RunResourceBackupInput {
  return {
    actorPrincipalId: 'prn_admin',
    context: {
      environment: createEnvironmentRow(),
      organization: createOrganizationRow(),
      project: createProjectRow(),
    },
    purpose: 'manual',
    resource: createProjectResourceRow(),
  };
}

function createOperationRecord(): OperationRecord {
  return {
    actorPrincipalId: 'prn_admin',
    completedAt: null,
    createdAt: new Date('2026-05-07T00:00:00.000Z'),
    id: 'op_backup',
    status: 'running',
    summary: 'Resource postgres backup is running.',
    targetId: 'res_postgres',
    targetType: 'resource',
    type: 'resource.backup',
  };
}

function createResourceBackupRow(status: ResourceBackupStatus): ResourceBackupRow {
  return {
    artifactLocation: null,
    checksum: null,
    completedAt: status === 'failed' ? new Date('2026-05-07T00:00:01.000Z') : null,
    createdAt: new Date('2026-05-07T00:00:00.000Z'),
    createdByPrincipalId: 'prn_admin',
    failureSummary: status === 'failed' ? 'backup directory unavailable' : null,
    id: 'rbak_test',
    manifestJson: null,
    operationId: 'op_backup',
    projectResourceId: 'res_postgres',
    purpose: 'manual',
    retentionDeletedAt: null,
    retentionReason: null,
    resourceDefinitionJson: null,
    sizeBytes: null,
    status,
    stderrSummary: null,
    stdoutSummary: null,
  };
}

function createProjectResourceRow(): ProjectResourceRow {
  return {
    commandJson: '[]',
    containerId: null,
    createdAt: new Date('2026-05-07T00:00:00.000Z'),
    envJson: '[]',
    environmentId: 'env_prod',
    hostname: 'postgres.prod.internal-tools.resource.internal',
    runtimeKind: 'node',
    expectedClaimsJson: '[]',
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    operationConfigHash: 'operation_hash',
    operationsJson: '{"backup":{"command":"pg_dump"},"restore":null}',
    portsJson: '[5432]',
    readinessJson: 'null',
    restartPolicy: 'unless-stopped',
    runtimeDefinitionHash: 'runtime_hash',
    status: 'running',
    updatedAt: new Date('2026-05-07T00:00:00.000Z'),
    volumesJson: '[]',
  };
}

function createEnvironmentRow(): EnvironmentRow {
  return {
    createdAt: new Date('2026-05-07T00:00:00.000Z'),
    id: 'env_prod',
    name: 'production',
    nodeId: 'node_1',
    projectId: 'prj_internal_tools',
    updatedAt: new Date('2026-05-07T00:00:00.000Z'),
  };
}

function createOrganizationRow(): OrganizationRow {
  return {
    id: 'org_acme',
    name: 'Acme',
    slug: 'acme',
  };
}

function createProjectRow(): ProjectRow {
  return {
    archivedAt: null,
    createdAt: new Date('2026-05-07T00:00:00.000Z'),
    id: 'prj_internal_tools',
    name: 'internal-tools',
    organizationId: 'org_acme',
    updatedAt: new Date('2026-05-07T00:00:00.000Z'),
  };
}
