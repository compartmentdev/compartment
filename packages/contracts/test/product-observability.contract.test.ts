import { describe, expect, it } from 'vitest';
import {
  edgePublishTrafficMetricsRequestSchema,
  productLogIngestRequestSchema,
  type EdgePublishTrafficMetricsRequest,
  type EdgeTrafficMetric,
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

  it('accepts bounded edge traffic batches and rejects unsafe counters', (): void => {
    const metric: EdgeTrafficMetric = {
      observedAt: '2026-07-12T10:00:00.000Z',
      requestBytes: 120,
      requestCount: 1,
      responseBytes: 240,
      status4xxCount: 0,
      status5xxCount: 0,
      upstreamHost: 'app-env-service.cpt-project.svc',
    };
    const batch: EdgePublishTrafficMetricsRequest = {
      batchId: 'source:1',
      metrics: [metric],
      sourceId: 'source',
    };
    expect(edgePublishTrafficMetricsRequestSchema.safeParse(batch).success).toBe(true);
    expect(
      edgePublishTrafficMetricsRequestSchema.safeParse({
        ...batch,
        metrics: [{ ...metric, requestBytes: Number.MAX_SAFE_INTEGER + 1 }],
      }).success,
    ).toBe(false);
    expect(
      edgePublishTrafficMetricsRequestSchema.safeParse({
        ...batch,
        metrics: Array.from({ length: 10_001 }, (): EdgeTrafficMetric => metric),
      }).success,
    ).toBe(false);
  });
});
