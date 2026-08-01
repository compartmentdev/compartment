import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { operations } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  InsertOperationInput,
  NewOperationRecord,
  OperationRecord,
  UpdateOperationInput,
} from './operations.query.types';

export async function insertOperationRecord(input: InsertOperationInput): Promise<OperationRecord> {
  return await insertOperationRecordWithExecutor(getApiDatabase(), input);
}

export async function findOperationRecordByType(type: string): Promise<OperationRecord | undefined> {
  const [operation] = await getApiDatabase().select().from(operations).where(eq(operations.type, type)).limit(1);
  return operation as OperationRecord | undefined;
}

export async function insertOperationRecordWithExecutor(
  executor: Pick<Database, 'insert'>,
  { actorPrincipalId, completedAt, status, summary, targetId, targetType, type }: InsertOperationInput,
): Promise<OperationRecord> {
  const operationRecord: NewOperationRecord = {
    actorPrincipalId,
    completedAt: completedAt ?? null,
    id: createId('op'),
    status,
    summary,
    targetId,
    targetType,
    type,
  };
  const [createdOperation] = await executor.insert(operations).values(operationRecord).returning();

  if (createdOperation === undefined) {
    throw new Error('Failed to persist operation record.');
  }

  return createdOperation as OperationRecord;
}

export async function updateOperationRecord(input: UpdateOperationInput): Promise<OperationRecord> {
  return await updateOperationRecordWithExecutor(getApiDatabase(), input);
}

export async function updateOperationRecordWithExecutor(
  executor: Pick<Database, 'update'>,
  { completedAt, operationId, status, summary }: UpdateOperationInput,
): Promise<OperationRecord> {
  const [updatedOperation] = await executor
    .update(operations)
    .set({
      completedAt: completedAt ?? null,
      status,
      ...(summary !== undefined ? { summary } : {}),
    })
    .where(eq(operations.id, operationId))
    .returning();

  if (updatedOperation === undefined) {
    throw new Error('Failed to update operation record.');
  }

  return updatedOperation as OperationRecord;
}
