import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ResourceBackupRow } from '../src/queries/resource-backups.query.types';
import type { ProjectResourceRow, ResourceTransaction } from '../src/queries/resources.query.types';
import { ResourceBackupRetentionOperationError } from '../src/services/resource-backup-retention-operation.error';
import { applyResourceBackupRetention } from '../src/services/resource-backups.retention.service';
import type { ResourceEnvironmentContext } from '../src/services/resources.service.types';

const deleteArtifact: Mock = vi.hoisted((): Mock => vi.fn());
const insertOperation: Mock = vi.hoisted((): Mock => vi.fn());
const listEligibleBackups: Mock = vi.hoisted((): Mock => vi.fn());
const markDeleted: Mock = vi.hoisted((): Mock => vi.fn());
const recordFailure: Mock = vi.hoisted((): Mock => vi.fn());
const transaction: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/services/resource-backups.kubernetes.service', (): object => ({
  deleteKubernetesBackupArtifact: deleteArtifact,
}));
vi.mock('../src/queries/operations.query', (): object => ({
  insertOperationRecordWithExecutor: insertOperation,
}));
vi.mock('../src/queries/resource-backups.query', (): object => ({
  listRetentionEligibleResourceBackups: listEligibleBackups,
  markResourceBackupRetentionDeletedWithExecutor: markDeleted,
  recordResourceBackupRetentionFailureWithExecutor: recordFailure,
}));
vi.mock('../src/runtime/runtime-access', (): object => ({
  getApiDatabase: (): object => ({ transaction }),
}));

describe('resource backup retention', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    const backup: ResourceBackupRow = resourceBackup();
    listEligibleBackups.mockResolvedValue([backup]);
    deleteArtifact.mockRejectedValue(new ResourceBackupRetentionOperationError('EACCES: permission denied'));
    recordFailure.mockResolvedValue({
      ...backup,
      retentionAttempts: 1,
      retentionFailureSummary: 'EACCES: permission denied',
      retentionNextAttemptAt: new Date('2026-07-22T12:01:00.000Z'),
    });
    insertOperation.mockResolvedValue({ id: 'op_retention_failure' });
    transaction.mockImplementation(
      async (run: (tx: ResourceTransaction) => Promise<void>): Promise<void> => await run({} as ResourceTransaction),
    );
  });

  it('records delete failure with backoff and completes the scheduled attempt normally', async (): Promise<void> => {
    const now: Date = new Date('2026-07-22T12:00:00.000Z');

    await expect(applyResourceBackupRetention(retentionInput(now))).resolves.toEqual({
      attempted: true,
      cleanedBackups: [],
      recordedFailure: true,
    });

    expect(recordFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        backupId: 'rbak_expired',
        failedAt: now,
        failureSummary: 'EACCES: permission denied',
        retryInitialDelayMs: 60_000,
        retryMaxDelayMs: 3_600_000,
      }),
    );
    expect(insertOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        completedAt: now,
        status: 'failed',
        targetId: 'rbak_expired',
        type: 'resource.backup.retention',
      }),
    );
    expect(markDeleted).not.toHaveBeenCalled();
  });

  it('does not hide persistence failures as operation failures', async (): Promise<void> => {
    recordFailure.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(applyResourceBackupRetention(retentionInput(new Date()))).rejects.toThrow('database unavailable');
  });

  it('does not classify control-plane failures as operation failures', async (): Promise<void> => {
    deleteArtifact.mockRejectedValueOnce(new Error('database unavailable before Job creation'));

    await expect(applyResourceBackupRetention(retentionInput(new Date()))).rejects.toThrow('database unavailable');
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('yields after one recorded failure instead of draining a runaway backlog', async (): Promise<void> => {
    listEligibleBackups.mockResolvedValueOnce([
      resourceBackup(),
      { ...resourceBackup(), createdAt: new Date('2026-07-20T12:00:00.000Z'), id: 'rbak_second' },
    ]);

    await expect(applyResourceBackupRetention(retentionInput(new Date()))).resolves.toMatchObject({
      recordedFailure: true,
    });

    expect(deleteArtifact).toHaveBeenCalledOnce();
    expect(recordFailure).toHaveBeenCalledOnce();
  });

  it('keeps failed cleanup out of the queue until its exponential backoff expires', async (): Promise<void> => {
    listEligibleBackups.mockResolvedValueOnce([
      { ...resourceBackup(), retentionNextAttemptAt: new Date('2026-07-22T12:01:00.000Z') },
    ]);

    await expect(applyResourceBackupRetention(retentionInput(new Date('2026-07-22T12:00:59.999Z')))).resolves.toEqual({
      attempted: false,
      cleanedBackups: [],
      recordedFailure: false,
    });

    expect(deleteArtifact).not.toHaveBeenCalled();
  });
});

function retentionInput(now: Date): {
  context: ResourceEnvironmentContext;
  now: Date;
  resource: ProjectResourceRow;
  retention: { keepLast: number };
} {
  return {
    context: {
      environment: { id: 'env_prod' },
      organization: { id: 'org' },
      project: { id: 'prj' },
    } as ResourceEnvironmentContext,
    now,
    resource: { id: 'res_postgres', name: 'postgres' } as ProjectResourceRow,
    retention: { keepLast: 0 },
  };
}

function resourceBackup(): ResourceBackupRow {
  return {
    artifactLocation: 'pvc://rbak_expired',
    checksum: null,
    completedAt: new Date('2026-07-21T12:00:00.000Z'),
    createdAt: new Date('2026-07-21T12:00:00.000Z'),
    createdByPrincipalId: null,
    failureSummary: null,
    id: 'rbak_expired',
    manifestJson: '{}',
    operationId: 'op_backup',
    projectResourceId: 'res_postgres',
    purpose: 'scheduled',
    resourceDefinitionJson: '{}',
    retentionAttempts: 0,
    retentionDeletedAt: null,
    retentionFailureSummary: null,
    retentionNextAttemptAt: null,
    retentionReason: null,
    sizeBytes: 42,
    status: 'succeeded',
    stderrSummary: '',
    stdoutSummary: 'dumped',
  };
}
