import type { WorkerPodResourceMetric } from '@compartment/contracts';
import type { UsageHourSlice } from './usage-aggregation.support.types';
import type { WorkloadUsageOwner } from './workload-usage-lock-order.support.types';

export interface RecordPodUsageInput {
  maximumIntervalMs: number;
  pods: WorkerPodResourceMetric[];
}

export type UsageOwner = WorkloadUsageOwner;

export interface UsageCheckpoint {
  observedAt: Date;
}

export type UsageHourIncrement = UsageOwner & UsageHourSlice;

export interface DeleteExpiredUsageBatchInput {
  before: Date;
  limit: number;
}
