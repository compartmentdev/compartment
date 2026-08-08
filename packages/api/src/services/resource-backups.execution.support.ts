import type { OperationRecord } from '../queries/operations.query.types';
import { updateOperationRecordWithExecutor } from '../queries/operations.query';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import type { ResourceTransaction } from '../queries/resources.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import type { RunResourceBackupInput } from './resources.service.types';

export function readOperationFailureSummary(error: Error): string {
  return error.message === '' ? 'Resource backup failed.' : error.message;
}

export async function completeResourceBackupOperationRecord(
  input: RunResourceBackupInput,
  operationRecord: OperationRecord,
  backup: ResourceBackupRow,
): Promise<void> {
  await getApiDatabase().transaction(async (tx: ResourceTransaction): Promise<void> => {
    await updateOperationRecordWithExecutor(tx, {
      completedAt: backup.completedAt,
      operationId: operationRecord.id,
      organizationId: input.context.organization.id,
      status: 'succeeded',
      summary: `Resource ${input.resource.name} backup succeeded.`,
    });
  });
}
