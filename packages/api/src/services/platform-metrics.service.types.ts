import type { Pool } from 'pg';
import type { PlatformMetricsSnapshot } from '../queries/platform-metrics.query.types';

export interface ApiPlatformMetricsRuntime {
  start(): Promise<number>;
  stop(): Promise<void>;
}

export interface CreateApiPlatformMetricsInput {
  primaryPool: Pool;
  readSnapshot(): Promise<PlatformMetricsSnapshot>;
  resourceOperationPool: Pool;
}
