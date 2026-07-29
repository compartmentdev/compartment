import { describe, expect, it } from 'vitest';
import {
  productLogIngestRequestSchema,
  type ProductLogIngestEvent,
  type WorkerApplicationPodMetric,
  workerListPodMetricNamespacesResponseSchema,
  workerPublishPodMetricsRequestSchema,
} from '../src';

const validLogEvent: ProductLogIngestEvent = {
  containerName: 'app-deployment',
  message: 'ready',
  namespace: 'cpt-project',
  podName: 'app-deployment-abc',
  podUid: '11111111-1111-4111-8111-111111111111',
  restartIdentity: '0',
  sourceFingerprint: 'a'.repeat(64),
  sourceOffset: 17,
  stream: 'stdout',
  timestamp: '2026-07-12T10:00:00.000Z',
};

describe('product observability contracts', (): void => {
  it('rejects missing immutable log identity and negative offsets', (): void => {
    expect(productLogIngestRequestSchema.safeParse([{ ...validLogEvent, podUid: '' }]).success).toBe(false);
    expect(productLogIngestRequestSchema.safeParse([{ ...validLogEvent, sourceOffset: -1 }]).success).toBe(false);
  });

  it('bounds each ingest batch', (): void => {
    expect(
      productLogIngestRequestSchema.safeParse(Array.from({ length: 201 }, (): ProductLogIngestEvent => validLogEvent))
        .success,
    ).toBe(false);
  });

  it('requires explicit metrics availability and Pod UID', (): void => {
    expect(
      workerPublishPodMetricsRequestSchema.safeParse({
        observedAt: '2026-07-12T10:00:00.000Z',
        pods: [{ cpuMillicores: 1, deploymentId: 'dep_1', memoryBytes: 1, namespace: 'cpt', podName: 'pod' }],
        state: 'available',
      }).success,
    ).toBe(false);
  });

  it('accepts application and resource workload identities', (): void => {
    const baseMetric: Omit<WorkerApplicationPodMetric, 'deploymentId' | 'kind'> = {
      cpuMillicores: 1,
      memoryBytes: 1,
      namespace: 'cpt',
      observedAt: '2026-07-12T10:00:00.000Z',
      podName: 'pod',
      podUid: '11111111-1111-4111-8111-111111111111',
    };
    expect(
      workerPublishPodMetricsRequestSchema.safeParse({
        observedAt: baseMetric.observedAt,
        pods: [
          { ...baseMetric, deploymentId: 'dep_1', kind: 'application' },
          { ...baseMetric, kind: 'resource', resourceId: 'res_1' },
        ],
        state: 'available',
      }).success,
    ).toBe(true);
  });

  it('requires explicit project namespace identifiers for metrics collection', (): void => {
    expect(workerListPodMetricNamespacesResponseSchema.parse({ namespaceIds: ['prj_1'] })).toEqual({
      namespaceIds: ['prj_1'],
    });
    expect(workerListPodMetricNamespacesResponseSchema.safeParse({ namespaceIds: [''] }).success).toBe(false);
  });
});
