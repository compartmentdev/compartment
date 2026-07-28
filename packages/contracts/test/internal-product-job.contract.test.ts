import { describe, expect, it } from 'vitest';
import {
  productJobIntentSchema,
  productJobRuntimeId,
  workerClaimProductJobRequestSchema,
  workerPersistProductJobIntentResponseSchema,
  workerPersistProductJobResultRequestSchema,
} from '../src';

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
  it('requires an explicit claim lane', (): void => {
    expect(workerClaimProductJobRequestSchema.safeParse({ jobClass: 'release' }).success).toBe(true);
    expect(workerClaimProductJobRequestSchema.safeParse({ jobClass: 'resource-operation' }).success).toBe(true);
    expect(workerClaimProductJobRequestSchema.safeParse({}).success).toBe(false);
  });

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

  it('returns current durable evidence when intent persistence is terminal', (): void => {
    expect(workerPersistProductJobIntentResponseSchema.safeParse({ result: null }).success).toBe(true);
    expect(workerPersistProductJobIntentResponseSchema.safeParse({ result: timedOutResult }).success).toBe(true);
    expect(workerPersistProductJobIntentResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('internal product Job mounts', (): void => {
  it('accepts PVC mounts and rejects host-path-shaped input', (): void => {
    const input: object = {
      command: ['bin/backup'],
      env: {},
      image: 'postgres@sha256:abc',
      jobClass: 'resource-operation',
      namespace: 'cpt-prj',
      operationId: 'operation-1',
      projectId: 'prj-1',
      resourceIds: ['res-1'],
      runtimeIdentity: 'resource',
      timeoutMs: 30_000,
      volumeMounts: [
        {
          claimName: 'backup-artifacts',
          expectedClaimUid: 'uid-backup',
          mountPath: '/backups',
          name: 'backup',
          resourceId: 'res-1',
          subPath: 'rbak-1',
        },
      ],
    };
    expect(productJobIntentSchema.safeParse(input).success).toBe(true);
    expect(productJobIntentSchema.safeParse({ ...input, runtimeIdentity: undefined }).success).toBe(false);
    expect(productJobIntentSchema.safeParse({ ...input, volumeMounts: [{ hostPath: '/tmp' }] }).success).toBe(false);
  });

  it('derives one canonical runtime identity for execution and cleanup', (): void => {
    expect(productJobRuntimeId('release', 'dep-1')).toBe('release-dep-1');
  });
});
