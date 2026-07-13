import type { KubePodMetricObservation, ObservePodMetrics } from '@compartment/kube-runtime';

export interface PodMetricsRuntime {
  observePodMetrics(input: ObservePodMetrics): Promise<KubePodMetricObservation[]>;
}
