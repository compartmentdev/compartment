import { and, eq } from 'drizzle-orm';
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

/**
 * Installation-wide lookup for singleton operations such as `compartment.install`.
 * Deliberately not tenant-scoped: the install operation predates any tenant context.
 */
export async function findOperationRecordByType(type: string): Promise<OperationRecord | undefined> {
  const [operation] = await getApiDatabase().select().from(operations).where(eq(operations.type, type)).limit(1);
  return operation as OperationRecord | undefined;
}

export async function insertOperationRecordWithExecutor(
  executor: Pick<Database, 'insert'>,
  { actorPrincipalId, completedAt, organizationId, status, summary, targetId, targetType, type }: InsertOperationInput,
): Promise<OperationRecord> {
  const operationRecord: NewOperationRecord = {
    actorPrincipalId,
    completedAt: completedAt ?? null,
    id: createId('op'),
    organizationId,
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
  { completedAt, operationId, organizationId, status, summary }: UpdateOperationInput,
): Promise<OperationRecord> {
  const [updatedOperation] = await executor
    .update(operations)
    .set({
      completedAt: completedAt ?? null,
      status,
      ...(summary !== undefined ? { summary } : {}),
    })
    .where(and(eq(operations.id, operationId), eq(operations.organizationId, organizationId)))
    .returning();

  if (updatedOperation === undefined) {
    throw new Error('Failed to update operation record.');
  }

  return updatedOperation as OperationRecord;
}
