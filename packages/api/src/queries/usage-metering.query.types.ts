import type { WorkerPodResourceMetric } from '@compartment/contracts';

export interface RecordPodUsageInput {
  maximumIntervalMs: number;
  pods: WorkerPodResourceMetric[];
}

export interface UsageOwner {
  environmentId: string;
  organizationId: string;
  projectId: string;
  resourceId: string | null;
  serviceId: string | null;
}

export interface UsageCheckpoint {
  observedAt: Date;
}

export interface DeleteExpiredUsageBatchInput {
  before: Date;
  limit: number;
}
