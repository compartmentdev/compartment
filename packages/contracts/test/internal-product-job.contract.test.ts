import { describe, expect, it } from 'vitest';
import { workerPersistProductJobResultRequestSchema } from '../src';

const timedOutResult: object = {
  completedAt: '2026-07-12T12:00:00.000Z',
  exitCode: null,
  identityId: 'dep-job',
  jobClass: 'release',
  jobName: 'cpt-job-dep-job',
  logs: '',
  podName: null,
  status: 'timed-out',
};

describe('internal product Job result contract', (): void => {
  it('represents a timeout before Pod creation without an invented Pod identity', (): void => {
    expect(workerPersistProductJobResultRequestSchema.safeParse(timedOutResult).success).toBe(true);
    expect(
      workerPersistProductJobResultRequestSchema.safeParse({ ...timedOutResult, podName: 'cpt-job-dep-job-pod' })
        .success,
    ).toBe(true);
    expect(workerPersistProductJobResultRequestSchema.safeParse({ ...timedOutResult, podName: '' }).success).toBe(
      false,
    );
  });
});
