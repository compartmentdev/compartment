import type { WorkerRunNextScheduledResourceOperationResponse } from '@compartment/contracts';
import type { ScheduledResourceOperationResult } from '../../services/resource-operation-scheduler.service.types';

export function buildWorkerRunNextScheduledResourceOperationResponse(
  result: ScheduledResourceOperationResult,
): WorkerRunNextScheduledResourceOperationResponse {
  return {
    backupId: result.backupId,
    cleanedBackups: result.cleanedBackups,
    operationType: result.operationType,
    resourceName: result.resourceName,
    ran: result.ran,
  };
}
