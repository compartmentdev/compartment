import type { SQL } from 'drizzle-orm';

export interface EdgeTrafficUsageMetricInput {
  hourBucket: Date;
  requestBytes: number;
  requestCount: number;
  responseBytes: number;
  status4xxCount: number;
  status5xxCount: number;
  upstreamHost: string;
}

export interface RecordEdgeTrafficUsageInput {
  batchId: string;
  metrics: EdgeTrafficUsageMetricInput[];
  sourceId: string;
}

export interface EdgeTrafficUsageRow {
  environmentId: string;
  hourBucket: Date;
  organizationId: string;
  projectId: string;
  requestBytes: number;
  requestCount: number;
  resourceId: null;
  responseBytes: number;
  serviceId: string;
  status4xxCount: number;
  status5xxCount: number;
}

export interface EdgeTrafficUsageIncrement {
  requestBytes: SQL;
  requestCount: SQL;
  responseBytes: SQL;
  status4xxCount: SQL;
  status5xxCount: SQL;
  updatedAt: Date;
}
