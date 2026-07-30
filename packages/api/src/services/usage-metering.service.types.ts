export interface PublishEdgeTrafficMetricInput {
  observedAt: Date;
  requestBytes: number;
  requestCount: number;
  responseBytes: number;
  status4xxCount: number;
  status5xxCount: number;
  upstreamHost: string;
}

export interface PublishEdgeTrafficMetricsInput {
  batchId: string;
  metrics: PublishEdgeTrafficMetricInput[];
  sourceId: string;
}

export type PublishEdgeTrafficMetricsResult = 'accepted' | 'duplicate';
