import { environmentVariableValues } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { insertVariableChangeAuditEventsWithExecutor } from './variables-audit.query';
import type {
  DeleteEnvironmentVariableValueInput,
  EnvironmentVariableDeleteAuditResult,
  InsertVariableChangeEventInput,
  PersistedEnvironmentVariableValueRow,
} from './variables.query.types';
import { buildEnvironmentVariableTargetPredicate, type VariablesWriteExecutor } from './variables.query.write.helpers';

export async function deleteEnvironmentVariableValueWithAudit(
  input: DeleteEnvironmentVariableValueInput,
  changeEvent: InsertVariableChangeEventInput,
): Promise<EnvironmentVariableDeleteAuditResult> {
  return await getApiDatabase().transaction(
    async (tx: VariablesWriteExecutor): Promise<EnvironmentVariableDeleteAuditResult> =>
      await deleteEnvironmentVariableValueWithExecutor(tx, input, changeEvent),
  );
}

async function deleteEnvironmentVariableValueWithExecutor(
  tx: VariablesWriteExecutor,
  input: DeleteEnvironmentVariableValueInput,
  changeEvent: InsertVariableChangeEventInput,
): Promise<EnvironmentVariableDeleteAuditResult> {
  const rows: PersistedEnvironmentVariableValueRow[] = await deleteVariableRows(tx, input);
  if (rows.length === 0) {
    return { auditEvents: [], deleted: false };
  }
  return {
    auditEvents: await insertVariableChangeAuditEventsWithExecutor(tx, changeEvent),
    deleted: true,
  };
}

async function deleteVariableRows(
  tx: VariablesWriteExecutor,
  input: DeleteEnvironmentVariableValueInput,
): Promise<PersistedEnvironmentVariableValueRow[]> {
  return await tx
    .delete(environmentVariableValues)
    .where(
      buildEnvironmentVariableTargetPredicate(
        input.environmentId,
        input.projectServiceId,
        input.targetResourceName,
        input.keyName,
      ),
    )
    .returning();
}
