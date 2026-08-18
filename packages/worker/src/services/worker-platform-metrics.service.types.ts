import type { PrometheusMetricsServer } from '@compartment/utils';
import type { WorkerCaughtError } from '../logging/worker-error-log.types';

export type HandleWorkerBuildFailure = (error: WorkerCaughtError) => void;

export type WorkerBuildMetricResult = 'failed' | 'succeeded';

export interface WorkerPlatformMetricsRuntime {
  server: PrometheusMetricsServer;
}
