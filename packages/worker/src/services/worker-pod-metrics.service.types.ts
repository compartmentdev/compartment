import type { KubePodMetricCollection, KubePodMetricObservation, ObservePodMetrics } from '@compartment/kube-runtime';

export interface PodMetricsRuntime {
  observePodMetrics(input: ObservePodMetrics): Promise<KubePodMetricCollection>;
}

export interface CollectedPodMetrics {
  hasPersistentGaps: boolean;
  observations: KubePodMetricObservation[];
}
