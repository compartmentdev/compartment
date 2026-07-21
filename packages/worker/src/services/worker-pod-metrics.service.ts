import type { WorkerPodResourceMetric, WorkerPublishPodMetricsRequest } from '@compartment/contracts';
import type { KubeContainerMetricUsage, KubePodMetricObservation } from '@compartment/kube-runtime';
import { publishPodMetrics, type CompartmentRequester } from '@compartment/sdk';
import type { Logger } from 'pino';
import { buildWorkerCaughtErrorLogPayload } from '../logging/worker-error-log';
import type { WorkerCaughtError } from '../logging/worker-error-log.types';
import { parseKubernetesQuantity } from './kubernetes-quantity';
import type { PodMetricsRuntime } from './worker-pod-metrics.service.types';

const managedLabels: Readonly<Record<string, string>> = { 'app.kubernetes.io/managed-by': 'compartment' };

export async function collectAndPublishPodMetrics(
  request: CompartmentRequester,
  runtime: PodMetricsRuntime,
  logger: Logger,
): Promise<void> {
  const requestedAt: string = new Date().toISOString();
  let observations: KubePodMetricObservation[];
  try {
    observations = await runtime.observePodMetrics({
      kind: 'pod-metrics',
      labels: managedLabels,
    });
  } catch (error) {
    await publishUnavailableSnapshot(request, logger, requestedAt, error as WorkerCaughtError);
    return;
  }
  await publishSnapshotIgnoringFailure(request, {
    observedAt: readSnapshotTimestamp(observations, requestedAt),
    pods: observations.map(toWorkerPodMetric),
    state: 'available',
  });
}

async function publishUnavailableSnapshot(
  request: CompartmentRequester,
  logger: Logger,
  observedAt: string,
  error: WorkerCaughtError,
): Promise<void> {
  logger.error(buildWorkerCaughtErrorLogPayload(error), 'Kubernetes Pod metrics collection failed.');
  await publishSnapshotIgnoringFailure(request, { observedAt, pods: [], state: 'unavailable' });
}

async function publishSnapshotIgnoringFailure(
  request: CompartmentRequester,
  snapshot: WorkerPublishPodMetricsRequest,
): Promise<void> {
  try {
    await publishPodMetrics(request, snapshot);
  } catch {
    return;
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
