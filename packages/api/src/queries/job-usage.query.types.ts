import type { ApiDatabaseTransaction } from '../db/client.types';

export interface RecordJobUsageInput {
  completedAt: Date;
  deploymentId: string;
  jobClass: 'build' | 'release';
  sourceKey: string;
  startedAt: Date;
}

export type JobUsageExecutor = ApiDatabaseTransaction;

export interface JobUsageOwner {
  environmentId: string;
  organizationId: string;
  projectId: string;
  serviceId: string;
}
