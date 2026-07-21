import type { KubePodMetricCollection, ObservePodMetrics } from '@compartment/kube-runtime';

export interface PodMetricsRuntime {
  observePodMetrics(input: ObservePodMetrics): Promise<KubePodMetricCollection>;
}
