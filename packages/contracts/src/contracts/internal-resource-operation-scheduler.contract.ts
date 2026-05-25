import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export const workerRunNextScheduledResourceOperationPathname: string =
  '/internal/resource-operations/run-next-scheduled';

export type WorkerScheduledResourceOperationType = 'backup';

export interface WorkerScheduledResourceOperationCleanupSummary {
  backupId: string;
  reason: string;
}

export interface WorkerRunNextScheduledResourceOperationResponse {
  backupId: string | null;
  cleanedBackups: WorkerScheduledResourceOperationCleanupSummary[];
  operationType: WorkerScheduledResourceOperationType | null;
  resourceName: string | null;
  ran: boolean;
}

const workerScheduledResourceOperationTypeSchema: ContractSchema<WorkerScheduledResourceOperationType> =
  z.literal('backup');
const workerScheduledResourceOperationCleanupSummarySchema: ContractSchema<WorkerScheduledResourceOperationCleanupSummary> =
  z
    .object({
      backupId: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict();

export const workerRunNextScheduledResourceOperationResponseSchema: ContractSchema<WorkerRunNextScheduledResourceOperationResponse> =
  z
    .object({
      backupId: z.string().min(1).nullable(),
      cleanedBackups: z.array(workerScheduledResourceOperationCleanupSummarySchema),
      operationType: workerScheduledResourceOperationTypeSchema.nullable(),
      resourceName: z.string().min(1).nullable(),
      ran: z.boolean(),
    })
    .strict();
