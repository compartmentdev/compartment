import type { ContainerMetric, PodMetric, V1Pod } from '@kubernetes/client-node';
import { kubeLabelSelector } from './kube-informer-registration';
import type {
  KubeContainerMetricUsage,
  KubePodListResult,
  KubePodListReader,
  KubePodMetricObservation,
  KubePodMetricListResult,
  KubePodMetricsReader,
  ObservePodMetrics,
} from './kube-pod-metrics.types';

interface PodMetricIdentity {
  deploymentId: string;
  namespace: string;
  podName: string;
  podUid: string;
}

interface NamespacePodMetricSnapshot {
  metrics: PodMetric[];
  pods: V1Pod[];
}

export async function readKubePodMetrics(
  coreApi: KubePodListReader,
  metricsApi: KubePodMetricsReader,
  input: ObservePodMetrics,
): Promise<KubePodMetricObservation[]> {
  const namespaceSnapshots: NamespacePodMetricSnapshot[] = await readNamespaceSnapshots(coreApi, metricsApi, input);
  const pods: V1Pod[] = namespaceSnapshots.flatMap((snapshot: NamespacePodMetricSnapshot): V1Pod[] => snapshot.pods);
  const metrics: PodMetric[] = namespaceSnapshots.flatMap(
    (snapshot: NamespacePodMetricSnapshot): PodMetric[] => snapshot.metrics,
  );
  const productPods: V1Pod[] = pods.filter(isObservableProductPod);
  if (productPods.length > 0 && metrics.length === 0) {
    throw new Error('metrics-server returned an incomplete product Pod snapshot.');
  }
  const metricByPod: Map<string, PodMetric> = indexMetricsByPod(metrics);
  const observations: KubePodMetricObservation[] = productPods.flatMap((pod: V1Pod): KubePodMetricObservation[] =>
    toPodMetricObservation(pod, metricByPod),
  );
  return observations;
}

async function readNamespaceSnapshots(
  coreApi: KubePodListReader,
  metricsApi: KubePodMetricsReader,
  input: ObservePodMetrics,
): Promise<NamespacePodMetricSnapshot[]> {
  const selector: string = kubeLabelSelector(input.labels);
  return await Promise.all(
    [...new Set(input.namespaces)].map(
      async (namespace: string): Promise<NamespacePodMetricSnapshot> =>
        await readNamespacePodMetrics(coreApi, metricsApi, namespace, selector),
    ),
  );
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
  return { metrics: metrics.items, pods: pods.items };
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
    pod.metadata?.labels?.['compartment.dev/deployment-id'] !== undefined &&
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
      deploymentId: identity.deploymentId,
      namespace: identity.namespace,
      observedAt: new Date(metric.timestamp),
      podName: identity.podName,
      podUid: identity.podUid,
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
  const namespace: string | undefined = pod.metadata?.namespace;
  const podName: string | undefined = pod.metadata?.name;
  const podUid: string | undefined = pod.metadata?.uid;
  return deploymentId === undefined || namespace === undefined || podName === undefined || podUid === undefined
    ? null
    : { deploymentId, namespace, podName, podUid };
}

function podMetricKey(namespace: string, podName: string): string {
  return `${namespace}/${podName}`;
}
