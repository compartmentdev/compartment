import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import { environmentVariableValues, variableChangeEvents } from '../db/schema';
import { createId } from '../lib/tokens';
import { mapSensitiveRow } from './variables.query.helpers';
import type {
  EnvironmentVariableValueRow,
  InsertVariableChangeEventInput,
  PersistedEnvironmentVariableValueRow,
  UpsertEnvironmentVariableValueInput,
} from './variables.query.types';

export type VariablesWriteExecutor = Pick<Database, 'delete' | 'insert' | 'select' | 'update'>;

export interface InsertEnvironmentVariableValueIfMissingResult {
  created: boolean;
  row: EnvironmentVariableValueRow;
}

export async function upsertEnvironmentVariableValueWithExecutor(
  executor: VariablesWriteExecutor,
  input: UpsertEnvironmentVariableValueInput,
): Promise<EnvironmentVariableValueRow> {
  const existingRow: EnvironmentVariableValueRow | undefined = await findEnvironmentVariableValueWithExecutor(
    executor,
    input.environmentId,
    input.projectServiceId,
    input.targetResourceName,
    input.keyName,
  );

  return existingRow === undefined
    ? await createEnvironmentVariableValueWithExecutor(executor, input)
    : await updateEnvironmentVariableValueWithExecutor(executor, input);
}

export async function insertEnvironmentVariableValueIfMissingWithExecutor(
  executor: VariablesWriteExecutor,
  input: UpsertEnvironmentVariableValueInput,
): Promise<InsertEnvironmentVariableValueIfMissingResult> {
  const existingRow: EnvironmentVariableValueRow | undefined = await findEnvironmentVariableValueWithExecutor(
    executor,
    input.environmentId,
    input.projectServiceId,
    input.targetResourceName,
    input.keyName,
  );
  if (existingRow !== undefined) {
    return {
      created: false,
      row: existingRow,
    };
  }

  return await createEnvironmentVariableValueIfMissingWithExecutor(executor, input);
}

async function createEnvironmentVariableValueIfMissingWithExecutor(
  executor: VariablesWriteExecutor,
  input: UpsertEnvironmentVariableValueInput,
): Promise<InsertEnvironmentVariableValueIfMissingResult> {
  const [createdRow]: PersistedEnvironmentVariableValueRow[] = await executor
    .insert(environmentVariableValues)
    .values(buildInsertEnvironmentVariableValue(input))
    .onConflictDoNothing()
    .returning();

  return {
    created: createdRow !== undefined,
    row:
      createdRow !== undefined
        ? mapSensitiveRow(createdRow)
        : await readRequiredEnvironmentVariableValueWithExecutor(executor, input),
  };
}

export async function insertVariableChangeEventWithExecutor(
  executor: Pick<Database, 'insert'>,
  input: InsertVariableChangeEventInput,
): Promise<void> {
  await executor.insert(variableChangeEvents).values({
    actorPrincipalId: input.actorPrincipalId,
    fingerprintsJson: input.fingerprintsJson ?? null,
    id: createId('vce'),
    keyNamesJson: input.keyNamesJson,
    operation: input.operation,
    organizationId: input.organizationId,
    sensitivityJson: input.sensitivityJson ?? null,
    targetId: input.targetId,
    targetType: input.targetType,
  });
}

async function createEnvironmentVariableValueWithExecutor(
  executor: VariablesWriteExecutor,
  input: UpsertEnvironmentVariableValueInput,
): Promise<EnvironmentVariableValueRow> {
  const [createdRow]: PersistedEnvironmentVariableValueRow[] = await executor
    .insert(environmentVariableValues)
    .values(buildInsertEnvironmentVariableValue(input))
    .returning();

  return mapRequiredEnvironmentVariableRow(createdRow);
}

async function updateEnvironmentVariableValueWithExecutor(
  executor: VariablesWriteExecutor,
  input: UpsertEnvironmentVariableValueInput,
): Promise<EnvironmentVariableValueRow> {
  const [updatedRow]: PersistedEnvironmentVariableValueRow[] = await executor
    .update(environmentVariableValues)
    .set(buildUpdateEnvironmentVariableValue(input))
    .where(
      buildEnvironmentVariableTargetPredicate(
        input.environmentId,
        input.projectServiceId,
        input.targetResourceName,
        input.keyName,
      ),
    )
    .returning();

  return mapRequiredEnvironmentVariableRow(updatedRow);
}

async function readRequiredEnvironmentVariableValueWithExecutor(
  executor: Pick<Database, 'select'>,
  input: UpsertEnvironmentVariableValueInput,
): Promise<EnvironmentVariableValueRow> {
  const row: EnvironmentVariableValueRow | undefined = await findEnvironmentVariableValueWithExecutor(
    executor,
    input.environmentId,
    input.projectServiceId,
    input.targetResourceName,
    input.keyName,
  );
  if (row === undefined) {
    throw new Error('Failed to persist environment variable value.');
  }

  return row;
}

async function findEnvironmentVariableValueWithExecutor(
  executor: Pick<Database, 'select'>,
  environmentId: string,
  projectServiceId: string | null,
  targetResourceName: string | null,
  keyName: string,
): Promise<EnvironmentVariableValueRow | undefined> {
  const rows: PersistedEnvironmentVariableValueRow[] = await executor
    .select()
    .from(environmentVariableValues)
    .where(buildEnvironmentVariableTargetPredicate(environmentId, projectServiceId, targetResourceName, keyName))
    .limit(1);

  return rows[0] !== undefined ? mapSensitiveRow(rows[0]) : undefined;
}

export function buildEnvironmentVariableTargetPredicate(
  environmentId: string,
  projectServiceId: string | null,
  targetResourceName: string | null,
  keyName: string,
): SQL | undefined {
  return and(
    eq(environmentVariableValues.environmentId, environmentId),
    eq(environmentVariableValues.keyName, keyName),
    projectServiceId === null
      ? isNull(environmentVariableValues.projectServiceId)
      : eq(environmentVariableValues.projectServiceId, projectServiceId),
    targetResourceName === null
      ? isNull(environmentVariableValues.targetResourceName)
      : eq(environmentVariableValues.targetResourceName, targetResourceName),
  );
}

function buildInsertEnvironmentVariableValue(
  input: UpsertEnvironmentVariableValueInput,
): PersistedEnvironmentVariableValueRow {
  return {
    createdAt: new Date(),
    createdByPrincipalId: input.createdByPrincipalId,
    encryptionKeyId: input.encryptionKeyId,
    environmentId: input.environmentId,
    id: input.id,
    keyName: input.keyName,
    projectServiceId: input.projectServiceId,
    targetResourceName: input.targetResourceName,
    sensitivity: input.sensitivity,
    updatedAt: input.updatedAt,
    updatedByPrincipalId: input.updatedByPrincipalId,
    valueCiphertext: input.valueCiphertext,
    valueFingerprint: input.valueFingerprint,
  };
}

function buildUpdateEnvironmentVariableValue(
  input: UpsertEnvironmentVariableValueInput,
): Pick<
  PersistedEnvironmentVariableValueRow,
  'encryptionKeyId' | 'sensitivity' | 'updatedAt' | 'updatedByPrincipalId' | 'valueCiphertext' | 'valueFingerprint'
> {
  return {
    encryptionKeyId: input.encryptionKeyId,
    sensitivity: input.sensitivity,
    updatedAt: input.updatedAt,
    updatedByPrincipalId: input.updatedByPrincipalId,
    valueCiphertext: input.valueCiphertext,
    valueFingerprint: input.valueFingerprint,
  };
}

function mapRequiredEnvironmentVariableRow(
  row: PersistedEnvironmentVariableValueRow | undefined,
): EnvironmentVariableValueRow {
  if (row === undefined) {
    throw new Error('Failed to persist environment variable value.');
  }

  return mapSensitiveRow(row);
}
