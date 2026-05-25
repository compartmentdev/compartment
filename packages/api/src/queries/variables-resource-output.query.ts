import { and, asc, eq, type SQL } from 'drizzle-orm';
import { environmentResourceOutputVariableBindings } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { insertVariableChangeEventWithExecutor, type VariablesWriteExecutor } from './variables.query.write.helpers';
import type {
  DeleteEnvironmentResourceOutputVariableBindingBySourceInput,
  DeleteEnvironmentResourceOutputVariableBindingInput,
  EnvironmentResourceOutputVariableBindingRow,
  EnvironmentResourceOutputVariableBindingSource,
  InsertVariableChangeEventInput,
  PersistedEnvironmentResourceOutputVariableBindingRow,
  UpsertEnvironmentResourceOutputVariableBindingInput,
} from './variables.query.types';

export async function listEnvironmentResourceOutputVariableBindings(
  environmentId: string,
): Promise<EnvironmentResourceOutputVariableBindingRow[]> {
  const rows: PersistedEnvironmentResourceOutputVariableBindingRow[] = await getApiDatabase()
    .select()
    .from(environmentResourceOutputVariableBindings)
    .where(eq(environmentResourceOutputVariableBindings.environmentId, environmentId))
    .orderBy(asc(environmentResourceOutputVariableBindings.keyName));

  return rows.map(toEnvironmentResourceOutputVariableBindingRow);
}

export async function deleteEnvironmentResourceOutputVariableBindingWithAudit(
  input: DeleteEnvironmentResourceOutputVariableBindingInput,
  changeEvent: InsertVariableChangeEventInput,
): Promise<boolean> {
  return await deleteEnvironmentResourceOutputVariableBindingWhereWithAudit(
    [
      eq(environmentResourceOutputVariableBindings.environmentId, input.environmentId),
      eq(environmentResourceOutputVariableBindings.targetServiceName, input.targetServiceName),
      eq(environmentResourceOutputVariableBindings.keyName, input.keyName),
    ],
    changeEvent,
  );
}

export async function deleteEnvironmentResourceOutputVariableBindingBySourceWithAudit(
  input: DeleteEnvironmentResourceOutputVariableBindingBySourceInput,
  changeEvent: InsertVariableChangeEventInput,
): Promise<boolean> {
  return await deleteEnvironmentResourceOutputVariableBindingWhereWithAudit(
    [
      eq(environmentResourceOutputVariableBindings.environmentId, input.environmentId),
      eq(environmentResourceOutputVariableBindings.targetServiceName, input.targetServiceName),
      eq(environmentResourceOutputVariableBindings.keyName, input.keyName),
      eq(environmentResourceOutputVariableBindings.source, input.source),
    ],
    changeEvent,
  );
}

async function deleteEnvironmentResourceOutputVariableBindingWhereWithAudit(
  predicates: SQL[],
  changeEvent: InsertVariableChangeEventInput,
): Promise<boolean> {
  return await getApiDatabase().transaction(async (tx: VariablesWriteExecutor): Promise<boolean> => {
    const rows: PersistedEnvironmentResourceOutputVariableBindingRow[] = await tx
      .delete(environmentResourceOutputVariableBindings)
      .where(and(...predicates))
      .returning();
    if (rows.length === 0) {
      return false;
    }

    await insertVariableChangeEventWithExecutor(tx, changeEvent);
    return true;
  });
}

export async function upsertEnvironmentResourceOutputVariableBindingWithAudit(
  input: UpsertEnvironmentResourceOutputVariableBindingInput,
  changeEvent: InsertVariableChangeEventInput,
): Promise<EnvironmentResourceOutputVariableBindingRow> {
  return await getApiDatabase().transaction(
    async (tx: VariablesWriteExecutor): Promise<EnvironmentResourceOutputVariableBindingRow> => {
      const rows: PersistedEnvironmentResourceOutputVariableBindingRow[] =
        await upsertEnvironmentResourceOutputVariableBinding(input, tx);
      await insertVariableChangeEventWithExecutor(tx, changeEvent);

      return toEnvironmentResourceOutputVariableBindingRow(requirePersistedResourceOutputBindingRow(rows[0]));
    },
  );
}

async function upsertEnvironmentResourceOutputVariableBinding(
  input: UpsertEnvironmentResourceOutputVariableBindingInput,
  tx: VariablesWriteExecutor,
): Promise<PersistedEnvironmentResourceOutputVariableBindingRow[]> {
  return await tx
    .insert(environmentResourceOutputVariableBindings)
    .values(input)
    .onConflictDoUpdate({
      target: [
        environmentResourceOutputVariableBindings.environmentId,
        environmentResourceOutputVariableBindings.targetServiceName,
        environmentResourceOutputVariableBindings.keyName,
      ],
      set: {
        outputName: input.outputName,
        resourceName: input.resourceName,
        source: input.source,
        updatedAt: input.updatedAt,
        updatedByPrincipalId: input.updatedByPrincipalId,
      },
    })
    .returning();
}

function toEnvironmentResourceOutputVariableBindingRow(
  row: PersistedEnvironmentResourceOutputVariableBindingRow,
): EnvironmentResourceOutputVariableBindingRow {
  return {
    ...row,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    source: readEnvironmentResourceOutputVariableBindingSource(row.source),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
  };
}

function readEnvironmentResourceOutputVariableBindingSource(
  source: string,
): EnvironmentResourceOutputVariableBindingSource {
  if (source === 'cli' || source === 'descriptor') {
    return source;
  }

  throw new Error(`Unsupported resource output variable binding source "${source}".`);
}

function requirePersistedResourceOutputBindingRow(
  row: PersistedEnvironmentResourceOutputVariableBindingRow | undefined,
): PersistedEnvironmentResourceOutputVariableBindingRow {
  if (row === undefined) {
    throw new Error('Failed to persist resource output variable binding.');
  }

  return row;
}
