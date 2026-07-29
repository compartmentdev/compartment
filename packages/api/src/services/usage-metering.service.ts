import type { WorkerPublishPodMetricsRequest } from '@compartment/contracts';
import { getApiConfig } from '../runtime/runtime-access';
import { recordPodUsage } from '../queries/usage-metering.query';
import { publishPodMetricsSnapshot } from './pod-metrics-snapshot.service';

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
