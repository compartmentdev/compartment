import type {
  WorkerListPodMetricNamespacesResponse,
  WorkerPodResourceMetric,
  WorkerPublishPodMetricsRequest,
} from '@compartment/contracts';
import {
  kubeNamespaceName,
  type KubeContainerMetricUsage,
  type KubePodMetricCollection,
  type KubePodMetricNamespaceFailure,
  type KubePodMetricObservation,
} from '@compartment/kube-runtime';
import { listPodMetricNamespaces, publishPodMetrics, type CompartmentRequester } from '@compartment/sdk';
import type { Logger } from 'pino';
import { buildWorkerCaughtErrorLogPayload } from '../logging/worker-error-log';
import type { WorkerCaughtError } from '../logging/worker-error-log.types';
import { parseKubernetesQuantity } from './kubernetes-quantity';
import type { CollectedPodMetrics, PodMetricsRuntime } from './worker-pod-metrics.service.types';

const managedLabels: Readonly<Record<string, string>> = { 'app.kubernetes.io/managed-by': 'compartment' };
const persistentFailureLogIntervalMs: number = 300_000;
const persistentFailureLogState: WeakMap<Logger, Map<string, PersistentFailureLogState>> = new WeakMap<
  Logger,
  Map<string, PersistentFailureLogState>
>();

interface PersistentFailureLogState {
  lastLoggedAt: number;
  suppressedRepeats: number;
}

export async function collectAndPublishPodMetrics(
  request: CompartmentRequester,
  runtime: PodMetricsRuntime,
  logger: Logger,
): Promise<void> {
  const requestedAt: string = new Date().toISOString();
  let collected: CollectedPodMetrics;
  try {
    const scope: WorkerListPodMetricNamespacesResponse = await listPodMetricNamespaces(request);
    collected = await collectPodMetrics(runtime, logger, scope);
  } catch (error) {
    await publishUnavailableSnapshot(request, logger, requestedAt, error as WorkerCaughtError);
    return;
  }
  if (!collected.hasPersistentGaps) {
    persistentFailureLogState.delete(logger);
  }
  await publishSnapshotIgnoringFailure(request, {
    observedAt: readSnapshotTimestamp(collected.observations, requestedAt),
    pods: collected.observations.map(toWorkerPodMetric),
    state: 'available',
  });
}

async function collectPodMetrics(
  runtime: PodMetricsRuntime,
  logger: Logger,
  scope: WorkerListPodMetricNamespacesResponse,
): Promise<CollectedPodMetrics> {
  const collection: KubePodMetricCollection = await runtime.observePodMetrics({
    kind: 'pod-metrics',
    labels: managedLabels,
    namespaces: scope.namespaceIds.map(kubeNamespaceName),
  });
  logTransientGaps(logger, collection.transientGaps);
  logPersistentGaps(logger, collection.persistentGaps);
  if (collection.successfulNamespaceCount > 0) {
    logNamespaceFailures(logger, collection.failures);
  }
  requireSuccessfulNamespace(collection, scope);
  return {
    hasPersistentGaps: collection.persistentGaps.length > 0,
    observations: collection.observations,
  };
}

function requireSuccessfulNamespace(
  collection: KubePodMetricCollection,
  scope: WorkerListPodMetricNamespacesResponse,
): void {
  if (collection.successfulNamespaceCount === 0 && scope.namespaceIds.length > 0) {
    throw new AggregateError(
      collection.failures.map((failure: KubePodMetricNamespaceFailure): Error => failure.reason),
      'Kubernetes Pod metrics collection failed in every namespace.',
    );
  }
}

function logPersistentGaps(logger: Logger, gaps: KubePodMetricNamespaceFailure[]): void {
  if (gaps.length === 0) {
    return;
  }
  logPersistentFailure(
    logger,
    new AggregateError(
      gaps.map((gap: KubePodMetricNamespaceFailure): Error => gap.reason),
      'Kubernetes Pod metrics samples remain incomplete.',
    ),
  );
}

function logTransientGaps(logger: Logger, gaps: KubePodMetricNamespaceFailure[]): void {
  for (const gap of gaps) {
    logger.debug(
      { namespace: gap.namespace, ...buildWorkerCaughtErrorLogPayload(gap.reason) },
      'Kubernetes Pod metrics sample is temporarily missing.',
    );
  }
}

function logNamespaceFailures(logger: Logger, failures: KubePodMetricNamespaceFailure[]): void {
  for (const failure of failures) {
    logger.warn(
      { namespace: failure.namespace, ...buildWorkerCaughtErrorLogPayload(failure.reason) },
      'Kubernetes Pod metrics namespace collection failed.',
    );
  }
}

async function publishUnavailableSnapshot(
  request: CompartmentRequester,
  logger: Logger,
  observedAt: string,
  error: WorkerCaughtError,
): Promise<void> {
  logPersistentFailure(logger, error);
  await publishSnapshotIgnoringFailure(request, { observedAt, pods: [], state: 'unavailable' });
}

function logPersistentFailure(logger: Logger, error: WorkerCaughtError): void {
  const now: number = Date.now();
  const failureKey: string = readPersistentFailureKey(error);
  const states: Map<string, PersistentFailureLogState> =
    persistentFailureLogState.get(logger) ?? new Map<string, PersistentFailureLogState>();
  const state: PersistentFailureLogState | undefined = states.get(failureKey);
  if (state !== undefined && now - state.lastLoggedAt < persistentFailureLogIntervalMs) {
    state.suppressedRepeats += 1;
    return;
  }
  const suppressedRepeats: number = state?.suppressedRepeats ?? 0;
  logger.error(
    {
      ...buildWorkerCaughtErrorLogPayload(error),
      ...(suppressedRepeats > 0 ? { suppressedRepeats } : {}),
    },
    'Kubernetes Pod metrics collection failed.',
  );
  states.set(failureKey, { lastLoggedAt: now, suppressedRepeats: 0 });
  persistentFailureLogState.set(logger, states);
}

function readPersistentFailureKey(error: WorkerCaughtError): string {
  if (error instanceof AggregateError) {
    const errors: WorkerCaughtError[] = error.errors as WorkerCaughtError[];
    const causes: string = errors
      .map((cause: WorkerCaughtError): string => readPersistentFailureCause(cause))
      .sort((left: string, right: string): number => left.localeCompare(right))
      .join('|');
    return `${error.name}:${error.message}:${causes}`;
  }
  return readPersistentFailureCause(error);
}

function readPersistentFailureCause(cause: WorkerCaughtError): string {
  if (cause instanceof Error) {
    return `${cause.name}:${cause.message}`;
  }
  return typeof cause === 'object' ? JSON.stringify(cause) : String(cause);
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
    memoryBytes: Math.round(sumUsage(observation, 'memory')),
    namespace: observation.namespace,
    observedAt: observation.observedAt.toISOString(),
    podName: observation.podName,
    podUid: observation.podUid,
    ...observation.workload,
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
