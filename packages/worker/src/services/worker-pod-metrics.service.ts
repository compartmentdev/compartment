import type { WorkerPodResourceMetric, WorkerPublishPodMetricsRequest } from '@compartment/contracts';
import type { KubeContainerMetricUsage, KubePodMetricObservation } from '@compartment/kube-runtime';
import { publishPodMetrics, type CompartmentRequester } from '@compartment/sdk';
import { parseKubernetesQuantity } from './kubernetes-quantity';
import type { PodMetricsRuntime } from './worker-pod-metrics.service.types';

const managedLabels: Readonly<Record<string, string>> = { 'app.kubernetes.io/managed-by': 'compartment' };

export async function collectAndPublishPodMetrics(
  request: CompartmentRequester,
  runtime: PodMetricsRuntime,
): Promise<void> {
  const requestedAt: string = new Date().toISOString();
  try {
    const observations: KubePodMetricObservation[] = await runtime.observePodMetrics({
      kind: 'pod-metrics',
      labels: managedLabels,
    });
    await publishPodMetrics(request, {
      observedAt: readSnapshotTimestamp(observations, requestedAt),
      pods: observations.map(toWorkerPodMetric),
      state: 'available',
    });
  } catch {
    const unavailable: WorkerPublishPodMetricsRequest = { observedAt: requestedAt, pods: [], state: 'unavailable' };
    try {
      await publishPodMetrics(request, unavailable);
    } catch {
      return;
    }
  }
}

function toWorkerPodMetric(observation: KubePodMetricObservation): WorkerPodResourceMetric {
  return {
    cpuMillicores: sumUsage(observation, 'cpu'),
    deploymentId: observation.deploymentId,
    memoryBytes: Math.round(sumUsage(observation, 'memory')),
    namespace: observation.namespace,
    observedAt: observation.observedAt.toISOString(),
    podName: observation.podName,
    podUid: observation.podUid,
  };
}

function readSnapshotTimestamp(observations: KubePodMetricObservation[], fallback: string): string {
  return observations.reduce(
    (oldest: string, observation: KubePodMetricObservation): string =>
      observation.observedAt.toISOString() < oldest ? observation.observedAt.toISOString() : oldest,
    fallback,
  );
}

function sumUsage(observation: KubePodMetricObservation, kind: 'cpu' | 'memory'): number {
  return observation.containers.reduce(
    (total: number, container: KubeContainerMetricUsage): number =>
      total + parseKubernetesQuantity(container[kind], kind),
    0,
  );
}
