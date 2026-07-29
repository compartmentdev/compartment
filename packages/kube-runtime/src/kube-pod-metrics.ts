import type { ContainerMetric, PodMetric, V1Pod } from '@kubernetes/client-node';
import { kubeLabelSelector } from './kube-informer-registration';
import type {
  KubeContainerMetricUsage,
  KubePodMetricCollection,
  KubePodListResult,
  KubePodListReader,
  KubePodMetricListResult,
  KubePodMetricNamespaceFailure,
  KubePodMetricObservation,
  KubePodMetricWorkload,
  KubePodMetricsReader,
  ObservePodMetrics,
} from './kube-pod-metrics.types';

interface PodMetricIdentity {
  namespace: string;
  podName: string;
  podUid: string;
  workload: KubePodMetricWorkload;
}

interface NamespacePodMetricSnapshot {
  metrics: PodMetric[];
  persistentGaps: KubePodMetricNamespaceFailure[];
  pods: V1Pod[];
  transientGaps: KubePodMetricNamespaceFailure[];
}

interface NamespacePodMetricReadResult {
  failures: KubePodMetricNamespaceFailure[];
  snapshots: NamespacePodMetricSnapshot[];
}

interface NamespacePodMetricReadSuccess {
  snapshot: NamespacePodMetricSnapshot;
  status: 'fulfilled';
}

interface NamespacePodMetricReadFailure extends KubePodMetricNamespaceFailure {
  status: 'rejected';
}

type NamespacePodMetricRead = NamespacePodMetricReadFailure | NamespacePodMetricReadSuccess;

export async function readKubePodMetrics(
  coreApi: KubePodListReader,
  metricsApi: KubePodMetricsReader,
  input: ObservePodMetrics,
): Promise<KubePodMetricCollection> {
  const namespaceResult: NamespacePodMetricReadResult = await readNamespaceSnapshots(coreApi, metricsApi, input);
  return buildPodMetricCollection(namespaceResult);
}

function buildPodMetricCollection(namespaceResult: NamespacePodMetricReadResult): KubePodMetricCollection {
  const namespaceSnapshots: NamespacePodMetricSnapshot[] = namespaceResult.snapshots;
  const pods: V1Pod[] = namespaceSnapshots.flatMap((snapshot: NamespacePodMetricSnapshot): V1Pod[] => snapshot.pods);
  const metrics: PodMetric[] = namespaceSnapshots.flatMap(
    (snapshot: NamespacePodMetricSnapshot): PodMetric[] => snapshot.metrics,
  );
  const productPods: V1Pod[] = pods.filter(isObservableProductPod);
  const metricByPod: Map<string, PodMetric> = indexMetricsByPod(metrics);
  const observations: KubePodMetricObservation[] = productPods.flatMap((pod: V1Pod): KubePodMetricObservation[] =>
    toPodMetricObservation(pod, metricByPod),
  );
  return {
    failures: namespaceResult.failures,
    observations,
    persistentGaps: namespaceSnapshots.flatMap(
      (snapshot: NamespacePodMetricSnapshot): KubePodMetricNamespaceFailure[] => snapshot.persistentGaps,
    ),
    successfulNamespaceCount: namespaceSnapshots.length,
    transientGaps: namespaceSnapshots.flatMap(
      (snapshot: NamespacePodMetricSnapshot): KubePodMetricNamespaceFailure[] => snapshot.transientGaps,
    ),
  };
}

async function readNamespaceSnapshots(
  coreApi: KubePodListReader,
  metricsApi: KubePodMetricsReader,
  input: ObservePodMetrics,
): Promise<NamespacePodMetricReadResult> {
  const selector: string = kubeLabelSelector(input.labels);
  const namespaces: string[] = [...new Set(input.namespaces)];
  const results: NamespacePodMetricRead[] = await Promise.all(
    namespaces.map(
      async (namespace: string): Promise<NamespacePodMetricRead> =>
        await readNamespacePodMetricsIsolated(coreApi, metricsApi, namespace, selector),
    ),
  );
  const snapshots: NamespacePodMetricSnapshot[] = [];
  const failures: KubePodMetricNamespaceFailure[] = [];
  results.forEach((result: NamespacePodMetricRead): void => {
    if (result.status === 'fulfilled') {
      snapshots.push(result.snapshot);
      return;
    }
    failures.push({ namespace: result.namespace, reason: result.reason });
  });
  return { failures, snapshots };
}

async function readNamespacePodMetricsIsolated(
  coreApi: KubePodListReader,
  metricsApi: KubePodMetricsReader,
  namespace: string,
  labelSelector: string,
): Promise<NamespacePodMetricRead> {
  try {
    return {
      snapshot: await readNamespacePodMetrics(coreApi, metricsApi, namespace, labelSelector),
      status: 'fulfilled',
    };
  } catch (reason) {
    return {
      namespace,
      reason:
        reason instanceof Error
          ? reason
          : new Error('Kubernetes namespace Pod metrics read failed.', { cause: reason }),
      status: 'rejected',
    };
  }
}

async function readNamespacePodMetrics(
  coreApi: KubePodListReader,
  metricsApi: KubePodMetricsReader,
  namespace: string,
  labelSelector: string,
): Promise<NamespacePodMetricSnapshot> {
  const [pods, metrics]: [KubePodListResult, KubePodMetricListResult] = await Promise.all([
    coreApi.listNamespacedPod({ labelSelector, namespace }),
    metricsApi.getPodMetrics(namespace),
  ]);
  return buildNamespacePodMetricSnapshot(pods.items, metrics.items, namespace);
}

function buildNamespacePodMetricSnapshot(
  pods: V1Pod[],
  metrics: PodMetric[],
  namespace: string,
): NamespacePodMetricSnapshot {
  const observablePods: V1Pod[] = pods.filter(isObservableProductPod);
  const unsampledPods: V1Pod[] = readUnsampledPods(observablePods, metrics);
  const freshUnsampledPods: V1Pod[] = unsampledPods.filter(isFreshPod);
  const persistentUnsampledPods: V1Pod[] = unsampledPods.filter((pod: V1Pod): boolean => !isFreshPod(pod));
  requireCompletePersistentSnapshot(persistentUnsampledPods, metrics);
  return {
    metrics,
    persistentGaps: buildNamespaceMetricGap(
      namespace,
      persistentUnsampledPods,
      'metrics-server is persistently missing product Pod samples.',
    ),
    pods,
    transientGaps: buildNamespaceMetricGap(
      namespace,
      freshUnsampledPods,
      'metrics-server has not sampled a fresh product Pod yet.',
    ),
  };
}

function requireCompletePersistentSnapshot(persistentUnsampledPods: V1Pod[], metrics: PodMetric[]): void {
  if (persistentUnsampledPods.length > 0 && metrics.length === 0) {
    throw new Error('metrics-server returned an incomplete product Pod snapshot.');
  }
}

function buildNamespaceMetricGap(namespace: string, pods: V1Pod[], message: string): KubePodMetricNamespaceFailure[] {
  return pods.length === 0 ? [] : [{ namespace, reason: new Error(message) }];
}

function readUnsampledPods(pods: V1Pod[], metrics: PodMetric[]): V1Pod[] {
  const sampledPods: Set<string> = new Set<string>(
    metrics.map((metric: PodMetric): string => podMetricKey(metric.metadata.namespace, metric.metadata.name)),
  );
  return pods.filter((pod: V1Pod): boolean => {
    const namespace: string | undefined = pod.metadata?.namespace;
    const name: string | undefined = pod.metadata?.name;
    return namespace !== undefined && name !== undefined && !sampledPods.has(podMetricKey(namespace, name));
  });
}

function isFreshPod(pod: V1Pod): boolean {
  const createdAt: Date | undefined = pod.metadata?.creationTimestamp;
  return createdAt !== undefined && Date.now() - createdAt.getTime() <= 180_000;
}

function indexMetricsByPod(metrics: PodMetric[]): Map<string, PodMetric> {
  return new Map<string, PodMetric>(
    metrics.map((metric: PodMetric): [string, PodMetric] => [
      podMetricKey(metric.metadata.namespace, metric.metadata.name),
      metric,
    ]),
  );
}

function isObservableProductPod(pod: V1Pod): boolean {
  return (
    (pod.metadata?.labels?.['compartment.dev/deployment-id'] !== undefined ||
      pod.metadata?.labels?.['compartment.dev/resource-id'] !== undefined) &&
    pod.status?.phase !== 'Succeeded' &&
    pod.status?.phase !== 'Failed'
  );
}

function toPodMetricObservation(pod: V1Pod, metricByPod: ReadonlyMap<string, PodMetric>): KubePodMetricObservation[] {
  const identity: PodMetricIdentity | null = readPodMetricIdentity(pod);
  if (identity === null) {
    return [];
  }
  const metric: PodMetric | undefined = metricByPod.get(podMetricKey(identity.namespace, identity.podName));
  if (metric === undefined) {
    return [];
  }
  return [
    {
      containers: readContainerUsage(metric.containers),
      namespace: identity.namespace,
      observedAt: new Date(metric.timestamp),
      podName: identity.podName,
      podUid: identity.podUid,
      workload: identity.workload,
    },
  ];
}

function readContainerUsage(containers: ContainerMetric[]): KubeContainerMetricUsage[] {
  return containers.map(
    (container: ContainerMetric): KubeContainerMetricUsage => ({
      cpu: container.usage.cpu,
      memory: container.usage.memory,
    }),
  );
}

function readPodMetricIdentity(pod: V1Pod): PodMetricIdentity | null {
  const deploymentId: string | undefined = pod.metadata?.labels?.['compartment.dev/deployment-id'];
  const resourceId: string | undefined = pod.metadata?.labels?.['compartment.dev/resource-id'];
  const namespace: string | undefined = pod.metadata?.namespace;
  const podName: string | undefined = pod.metadata?.name;
  const podUid: string | undefined = pod.metadata?.uid;
  if (namespace === undefined || podName === undefined || podUid === undefined) {
    return null;
  }
  if (deploymentId !== undefined) {
    return { namespace, podName, podUid, workload: { deploymentId, kind: 'application' } };
  }
  return resourceId === undefined ? null : { namespace, podName, podUid, workload: { kind: 'resource', resourceId } };
}

function podMetricKey(namespace: string, podName: string): string {
  return `${namespace}/${podName}`;
}
