import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deploymentMetricsSnapshotSchema,
  type DeploymentMetricsSnapshot,
  type WorkerPodResourceMetric,
  type WorkerPublishPodMetricsRequest,
} from '@compartment/contracts';
import { publishPodMetricsSnapshot, readPodMetricsSnapshot } from '../src/services/pod-metrics-snapshot.service';
import type { DeploymentSummaryInput } from '../src/services/presenter.types';

describe('Pod metrics snapshots', (): void => {
  afterEach((): void => {
    publishPodMetricsSnapshot({ observedAt: new Date().toISOString(), pods: [], state: 'unavailable' });
    vi.useRealTimers();
  });

  it('filters metrics by requested deployment and marks old samples stale', (): void => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-07-13T12:01:00.000Z');
    publishPodMetricsSnapshot(snapshot());

    const result: DeploymentMetricsSnapshot = readPodMetricsSnapshot([deployment('dep-a', 'web')]);
    expect(result).toEqual({
      observedAt: '2026-07-13T12:00:00.000Z',
      pods: [expect.objectContaining({ deploymentId: 'dep-a', serviceName: 'web' })],
      state: 'stale',
    });
    expect(deploymentMetricsSnapshotSchema.safeParse(result).success).toBe(true);
  });
});

function snapshot(): WorkerPublishPodMetricsRequest {
  return {
    observedAt: '2026-07-13T12:00:00.000Z',
    pods: [
      pod('dep-a', 'pod-a', '11111111-1111-4111-8111-111111111111'),
      pod('dep-b', 'pod-b', '22222222-2222-4222-8222-222222222222'),
    ],
    state: 'available',
  };
}

function pod(deploymentId: string, podName: string, podUid: string): WorkerPodResourceMetric {
  return {
    cpuMillicores: 125,
    deploymentId,
    memoryBytes: 67_108_864,
    namespace: 'cpt-project',
    observedAt: '2026-07-13T12:00:00.000Z',
    podName,
    podUid,
  };
}

function deployment(deploymentId: string, serviceName: string): DeploymentSummaryInput {
  return {
    deployment: { id: deploymentId },
    service: { name: serviceName },
  } as DeploymentSummaryInput;
}
