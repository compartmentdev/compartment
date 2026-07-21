import type { PodMetric, V1Pod } from '@kubernetes/client-node';

export interface KubePodListInput {
  labelSelector: string;
}

export interface KubePodListResult {
  items: V1Pod[];
}

export interface KubePodMetricListResult {
  items: PodMetric[];
}

export interface KubePodListReader {
  listPodForAllNamespaces(input: KubePodListInput): Promise<KubePodListResult>;
}

export interface KubePodMetricsReader {
  getPodMetrics(namespace: string): Promise<KubePodMetricListResult>;
}

export interface ObservePodMetrics {
  kind: 'pod-metrics';
  labels: Readonly<Record<string, string>>;
}

export interface KubeContainerMetricUsage {
  cpu: string;
  memory: string;
}

export interface KubePodMetricObservation {
  containers: KubeContainerMetricUsage[];
  deploymentId: string;
  namespace: string;
  observedAt: Date;
  podName: string;
  podUid: string;
}
