import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ScheduledResourceOperationCandidateRow } from '../src/queries/resource-operation-scheduler.query.types';
import { runNextScheduledResourceOperationForWorker } from '../src/services/resource-operation-scheduler.service';

const listCandidates: Mock = vi.hoisted((): Mock => vi.fn());
const runScheduledBackup: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/queries/resource-operation-scheduler.query', (): object => ({
  listScheduledResourceOperationCandidates: listCandidates,
}));
vi.mock('../src/services/resource-backups.service', (): object => ({
  runDueScheduledResourceBackup: runScheduledBackup,
}));

describe('resource operation scheduler service', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });

  it('defers scheduled backups until PVC identities are persisted without blocking other work', async (): Promise<void> => {
    const unfenced: ScheduledResourceOperationCandidateRow = candidate('postgres', '[]');
    const fenced: ScheduledResourceOperationCandidateRow = candidate(
      'redis',
      '[{"claimName":"volume-redis","uid":"uid-redis"}]',
    );
    listCandidates.mockResolvedValue([unfenced, fenced]);
    runScheduledBackup.mockResolvedValue({
      backup: { id: 'rbak_redis' },
      cleanedBackups: [],
      recordedFailure: false,
      resource: fenced.resource,
    });

    await expect(runNextScheduledResourceOperationForWorker()).resolves.toMatchObject({
      backupId: 'rbak_redis',
      resourceName: 'redis',
      ran: true,
    });

    expect(runScheduledBackup).toHaveBeenCalledOnce();
    expect(runScheduledBackup).toHaveBeenCalledWith(fenced, 'redis', expect.any(Date));
  });

  it('returns a normal response that identifies a durably recorded retention failure', async (): Promise<void> => {
    const scheduled: ScheduledResourceOperationCandidateRow = candidate(
      'postgres',
      '[{"claimName":"volume-postgres","uid":"uid-postgres"}]',
    );
    listCandidates.mockResolvedValue([scheduled]);
    runScheduledBackup.mockResolvedValue({
      backup: null,
      cleanedBackups: [],
      recordedFailure: true,
      resource: scheduled.resource,
    });

    await expect(runNextScheduledResourceOperationForWorker()).resolves.toMatchObject({
      backupId: null,
      recordedFailure: true,
      resourceName: 'postgres',
      ran: true,
    });
  });
});

function candidate(resourceName: string, expectedClaimsJson: string): ScheduledResourceOperationCandidateRow {
  return {
    environment: { id: 'env_prod' },
    organization: { id: 'org', name: 'Organization', slug: 'organization' },
    project: { id: 'prj' },
    resource: { expectedClaimsJson, name: resourceName },
  } as ScheduledResourceOperationCandidateRow;
}
