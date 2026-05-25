import { describe, expect, it } from 'vitest';
import type { ResourceBackupRow } from '../src/queries/resource-backups.query.types';
import { isResourceOperationScheduleDue } from '../src/services/resource-operation-schedule.service';

describe('resource operation schedule service', (): void => {
  it('runs interval schedules after the interval has elapsed', (): void => {
    const now: Date = new Date('2026-05-08T12:00:00.000Z');

    expect(isResourceOperationScheduleDue({ interval: 'hourly' }, null, now)).toBe(true);
    expect(isResourceOperationScheduleDue({ interval: 'hourly' }, createBackup('2026-05-08T11:00:00.000Z'), now)).toBe(
      true,
    );
    expect(isResourceOperationScheduleDue({ interval: 'hourly' }, createBackup('2026-05-08T11:30:00.000Z'), now)).toBe(
      false,
    );
  });

  it('runs cron schedules once for the latest matched minute', (): void => {
    const now: Date = new Date('2026-05-08T02:00:30.000Z');

    expect(isResourceOperationScheduleDue({ cron: '0 2 * * *' }, null, now)).toBe(true);
    expect(isResourceOperationScheduleDue({ cron: '0 2 * * *' }, createBackup('2026-05-08T02:00:00.000Z'), now)).toBe(
      false,
    );
    expect(isResourceOperationScheduleDue({ cron: '15 2 * * *' }, null, now)).toBe(false);
  });

  it('allows first cron runs when the worker polls shortly after the matched minute', (): void => {
    expect(isResourceOperationScheduleDue({ cron: '0 2 * * *' }, null, new Date('2026-05-08T02:04:30.000Z'))).toBe(
      true,
    );
    expect(isResourceOperationScheduleDue({ cron: '0 2 * * *' }, null, new Date('2026-05-08T02:06:00.000Z'))).toBe(
      false,
    );
  });

  it('supports standard cron steps, day-of-week, and day-of-month fields', (): void => {
    expect(isResourceOperationScheduleDue({ cron: '*/15 * * * *' }, null, new Date('2026-05-08T12:15:30.000Z'))).toBe(
      true,
    );
    expect(
      isResourceOperationScheduleDue(
        { cron: '*/15 * * * *' },
        createBackup('2026-05-08T12:15:00.000Z'),
        new Date('2026-05-08T12:15:30.000Z'),
      ),
    ).toBe(false);
    expect(isResourceOperationScheduleDue({ cron: '0 2 * * 1' }, null, new Date('2026-05-04T02:00:30.000Z'))).toBe(
      true,
    );
    expect(isResourceOperationScheduleDue({ cron: '0 2 * * 1' }, null, new Date('2026-05-05T02:00:30.000Z'))).toBe(
      false,
    );
    expect(isResourceOperationScheduleDue({ cron: '0 2 1 * *' }, null, new Date('2026-05-01T02:00:30.000Z'))).toBe(
      true,
    );
    expect(isResourceOperationScheduleDue({ cron: '0 2 1 * *' }, null, new Date('2026-05-02T02:00:30.000Z'))).toBe(
      false,
    );
  });

  it('ignores non-standard or invalid persisted cron expressions', (): void => {
    const now: Date = new Date('2026-05-08T02:00:30.000Z');

    expect(isResourceOperationScheduleDue({ cron: '0 0 0 * * *' }, null, now)).toBe(false);
    expect(isResourceOperationScheduleDue({ cron: '@daily' }, null, now)).toBe(false);
    expect(isResourceOperationScheduleDue({ cron: '60 * * * *' }, null, now)).toBe(false);
  });
});

function createBackup(createdAt: string): ResourceBackupRow {
  return {
    artifactLocation: '/tmp/backups/rbak_schedule',
    checksum: 'sha256:abc',
    completedAt: new Date(createdAt),
    createdAt: new Date(createdAt),
    createdByPrincipalId: null,
    failureSummary: null,
    id: 'rbak_schedule',
    manifestJson: null,
    operationId: 'op_schedule',
    projectResourceId: 'res_schedule',
    purpose: 'scheduled',
    retentionDeletedAt: null,
    retentionReason: null,
    resourceDefinitionJson: null,
    sizeBytes: 1,
    status: 'succeeded',
    stderrSummary: '',
    stdoutSummary: '',
  };
}
