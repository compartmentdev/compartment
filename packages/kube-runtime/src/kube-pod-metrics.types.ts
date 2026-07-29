import type { PodMetric, V1Pod } from '@kubernetes/client-node';

export interface KubeNamespacedPodListInput {
  labelSelector: string;
  namespace: string;
}

export interface KubePodListResult {
  items: V1Pod[];
}

export interface KubePodMetricListResult {
  items: PodMetric[];
}

export interface KubePodListReader {
  listNamespacedPod(input: KubeNamespacedPodListInput): Promise<KubePodListResult>;
}

export interface KubePodMetricsReader {
  getPodMetrics(namespace: string): Promise<KubePodMetricListResult>;
}

export interface ObservePodMetrics {
  kind: 'pod-metrics';
  labels: Readonly<Record<string, string>>;
  namespaces: string[];
}

export interface KubeContainerMetricUsage {
  cpu: string;
  memory: string;
}

export interface KubeApplicationPodMetricWorkload {
  deploymentId: string;
  kind: 'application';
}

export interface KubeResourcePodMetricWorkload {
  kind: 'resource';
  resourceId: string;
}

export type KubePodMetricWorkload = KubeApplicationPodMetricWorkload | KubeResourcePodMetricWorkload;

export interface KubePodMetricObservation {
  containers: KubeContainerMetricUsage[];
  namespace: string;
  observedAt: Date;
  podName: string;
  podUid: string;
  workload: KubePodMetricWorkload;
}

export interface KubePodMetricNamespaceFailure {
  namespace: string;
  reason: Error;
}

export interface KubePodMetricCollection {
  failures: KubePodMetricNamespaceFailure[];
  observations: KubePodMetricObservation[];
  persistentGaps: KubePodMetricNamespaceFailure[];
  successfulNamespaceCount: number;
  transientGaps: KubePodMetricNamespaceFailure[];
}
