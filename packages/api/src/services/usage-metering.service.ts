import type { WorkerPublishPodMetricsRequest } from '@compartment/contracts';
import { getApiConfig } from '../runtime/runtime-access';
import { recordEdgeTrafficUsage } from '../queries/edge-traffic-metering.query';
import type {
  EdgeTrafficUsageMetricInput,
  RecordEdgeTrafficUsageInput,
} from '../queries/edge-traffic-metering.query.types';
import { recordPodUsage } from '../queries/usage-metering.query';
import { readUsageHourBucket } from '../queries/usage-aggregation.support';
import { publishPodMetricsSnapshot } from './pod-metrics-snapshot.service';
import type {
  PublishEdgeTrafficMetricInput,
  PublishEdgeTrafficMetricsInput,
  PublishEdgeTrafficMetricsResult,
} from './usage-metering.service.types';

export async function publishMeteredPodMetrics(input: WorkerPublishPodMetricsRequest): Promise<void> {
  publishPodMetricsSnapshot(input);
  if (input.state === 'unavailable') {
    return;
  }
  await recordPodUsage({
    maximumIntervalMs: Math.round(getApiConfig().usageMeteringIntervalMs * 1.5),
    pods: input.pods,
  });
}

export async function publishEdgeTrafficMetrics(
  input: PublishEdgeTrafficMetricsInput,
): Promise<PublishEdgeTrafficMetricsResult> {
  const queryInput: RecordEdgeTrafficUsageInput = {
    batchId: input.batchId,
    metrics: input.metrics.map(toEdgeTrafficUsageMetricInput),
    sourceId: input.sourceId,
  };
  return (await recordEdgeTrafficUsage(queryInput)) ? 'accepted' : 'duplicate';
}

function toEdgeTrafficUsageMetricInput(metric: PublishEdgeTrafficMetricInput): EdgeTrafficUsageMetricInput {
  return {
    hourBucket: readUsageHourBucket(metric.observedAt),
    requestBytes: metric.requestBytes,
    requestCount: metric.requestCount,
    responseBytes: metric.responseBytes,
    status4xxCount: metric.status4xxCount,
    status5xxCount: metric.status5xxCount,
    upstreamHost: metric.upstreamHost,
  };
}
