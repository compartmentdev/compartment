import { and, asc, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import {
  deploymentKubeReferences,
  deploymentProductLogs,
  deployments,
  environments,
  productLogStoreQuota,
  projectResources,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { ApiDatabaseTransaction } from '../db/client.types';
import type {
  DeleteExpiredDeploymentProductLogsInput,
  DeploymentLogIdentityRow,
  DeploymentProductLogLine,
  InsertDeploymentProductLogsResult,
  InsertProductLogInput,
  InsertedProductLogMessage,
  ListDeploymentProductLogsInput,
  ListResourceProductLogsInput,
  ProductLogQuotaRow,
  ResourceLogIdentityRow,
  ResourceProductLogLine,
} from './deployment-product-logs.query.types';
import {
  productLogRecordBytes,
  productLogRecordOverheadBytes,
  productLogStoreMaxBytes,
} from './product-log-storage-policy';

interface DeleteExpiredProductLogsBatchResult {
  rows: object[];
}

export async function listDeploymentLogIdentities(namespaces: string[]): Promise<DeploymentLogIdentityRow[]> {
  if (namespaces.length === 0) {
    return [];
  }
  return await getApiDatabase()
    .select({
      createdAt: deployments.createdAt,
      deploymentId: deploymentKubeReferences.deploymentId,
      deploymentName: deploymentKubeReferences.deploymentName,
      namespace: deploymentKubeReferences.namespace,
    })
    .from(deploymentKubeReferences)
    .innerJoin(deployments, eq(deployments.id, deploymentKubeReferences.deploymentId))
    .where(inArray(deploymentKubeReferences.namespace, namespaces))
    .orderBy(asc(deployments.createdAt));
}

export async function listResourceLogIdentities(): Promise<ResourceLogIdentityRow[]> {
  return await getApiDatabase()
    .select({
      createdAt: projectResources.createdAt,
      namespaceId: environments.projectId,
      resourceId: projectResources.id,
    })
    .from(projectResources)
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .where(eq(projectResources.runtimeKind, 'kubernetes'))
    .orderBy(asc(projectResources.createdAt));
}

export async function insertDeploymentProductLogs(
  events: InsertProductLogInput[],
): Promise<InsertDeploymentProductLogsResult> {
  if (events.length === 0) {
    return { inserted: 0, quotaAccepted: 0 };
  }
  return await getApiDatabase().transaction(
    async (transaction: ApiDatabaseTransaction): Promise<InsertDeploymentProductLogsResult> =>
      await insertDeploymentProductLogsWithQuota(transaction, events),
  );
}

async function insertDeploymentProductLogsWithQuota(
  transaction: ApiDatabaseTransaction,
  events: InsertProductLogInput[],
): Promise<InsertDeploymentProductLogsResult> {
  const quota: ProductLogQuotaRow = await lockProductLogQuota(transaction);
  const quotaEvents: InsertProductLogInput[] = takeEventsWithinQuota(events, productLogStoreMaxBytes - quota.usedBytes);
  return quotaEvents.length === 0
    ? { inserted: 0, quotaAccepted: 0 }
    : await insertQuotaAcceptedProductLogs(transaction, quotaEvents);
}

async function insertQuotaAcceptedProductLogs(
  transaction: ApiDatabaseTransaction,
  events: InsertProductLogInput[],
): Promise<InsertDeploymentProductLogsResult> {
  const inserted: InsertedProductLogMessage[] = await transaction
    .insert(deploymentProductLogs)
    .values(events.map(toInsertValues))
    .onConflictDoNothing()
    .returning({ message: deploymentProductLogs.message });
  const insertedBytes: number = inserted.reduce(
    (total: number, row: InsertedProductLogMessage): number =>
      total + Buffer.byteLength(row.message, 'utf8') + productLogRecordOverheadBytes,
    0,
  );
  await addProductLogStoreUsage(transaction, insertedBytes);
  return { inserted: inserted.length, quotaAccepted: events.length };
}

async function addProductLogStoreUsage(transaction: ApiDatabaseTransaction, insertedBytes: number): Promise<void> {
  if (insertedBytes === 0) {
    return;
  }
  await transaction
    .update(productLogStoreQuota)
    .set({ usedBytes: sql`${productLogStoreQuota.usedBytes} + ${insertedBytes}` })
    .where(eq(productLogStoreQuota.id, 'global'));
}

function takeEventsWithinQuota(events: InsertProductLogInput[], availableBytes: number): InsertProductLogInput[] {
  let remainingBytes: number = Math.max(0, availableBytes);
  return events.filter((event: InsertProductLogInput): boolean => {
    const eventBytes: number = productLogRecordBytes(event);
    if (eventBytes > remainingBytes) {
      return false;
    }
    remainingBytes -= eventBytes;
    return true;
  });
}

export async function listDeploymentProductLogLines(
  input: ListDeploymentProductLogsInput,
): Promise<DeploymentProductLogLine[]> {
  if (input.deploymentIds.length === 0) {
    return [];
  }
  const rows: (typeof deploymentProductLogs.$inferSelect)[] = await getApiDatabase()
    .select()
    .from(deploymentProductLogs)
    .where(productLogReadPredicate(input))
    .orderBy(desc(deploymentProductLogs.occurredAt), desc(deploymentProductLogs.sourceOffset))
    .limit(input.limit);
  return rows.toReversed().map(
    (row: typeof deploymentProductLogs.$inferSelect): DeploymentProductLogLine => ({
      deploymentId: requiredDeploymentId(row.deploymentId),
      environmentName: '',
      message: row.message,
      serviceName: '',
      stream: row.stream,
      timestamp: row.occurredAt.toISOString(),
    }),
  );
}

function requiredDeploymentId(deploymentId: string | null): string {
  if (deploymentId === null) {
    throw new Error('Stored deployment product log is missing its deployment owner.');
  }
  return deploymentId;
}

export async function listResourceProductLogLines(
  input: ListResourceProductLogsInput,
): Promise<ResourceProductLogLine[]> {
  const predicate: SQL =
    input.since === undefined
      ? eq(deploymentProductLogs.resourceId, input.resourceId)
      : and(
          eq(deploymentProductLogs.resourceId, input.resourceId),
          gte(deploymentProductLogs.occurredAt, input.since),
        )!;
  const rows: (typeof deploymentProductLogs.$inferSelect)[] = await getApiDatabase()
    .select()
    .from(deploymentProductLogs)
    .where(predicate)
    .orderBy(desc(deploymentProductLogs.occurredAt), desc(deploymentProductLogs.sourceOffset))
    .limit(input.limit);
  return rows.toReversed().map(
    (row: typeof deploymentProductLogs.$inferSelect): ResourceProductLogLine => ({
      message: row.message,
      resourceName: '',
      stream: row.stream,
      timestamp: row.occurredAt.toISOString(),
    }),
  );
}

export async function deleteExpiredDeploymentProductLogsBatch(
  input: DeleteExpiredDeploymentProductLogsInput,
): Promise<number> {
  return await getApiDatabase().transaction(async (transaction: ApiDatabaseTransaction): Promise<number> => {
    await lockProductLogQuota(transaction);
    return await deleteExpiredDeploymentProductLogsWithTransaction(transaction, input);
  });
}

async function deleteExpiredDeploymentProductLogsWithTransaction(
  transaction: ApiDatabaseTransaction,
  input: DeleteExpiredDeploymentProductLogsInput,
): Promise<number> {
  const result: DeleteExpiredProductLogsBatchResult = await transaction.execute(sql`
    WITH expired_product_logs AS (
      SELECT ${deploymentProductLogs.podUid}, ${deploymentProductLogs.containerName},
        ${deploymentProductLogs.restartIdentity}, ${deploymentProductLogs.sourceOffset}, ${deploymentProductLogs.sourceFingerprint}
      FROM ${deploymentProductLogs}
      WHERE ${deploymentProductLogs.capturedAt} < ${input.capturedBefore}
      ORDER BY ${deploymentProductLogs.capturedAt} ASC
      LIMIT ${input.limit}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM ${deploymentProductLogs}
    USING expired_product_logs
    WHERE ${deploymentProductLogs.podUid} = expired_product_logs.pod_uid
      AND ${deploymentProductLogs.containerName} = expired_product_logs.container_name
      AND ${deploymentProductLogs.restartIdentity} = expired_product_logs.restart_identity
      AND ${deploymentProductLogs.sourceOffset} = expired_product_logs.source_offset
      AND ${deploymentProductLogs.sourceFingerprint} = expired_product_logs.source_fingerprint
    RETURNING ${deploymentProductLogs.sourceOffset}
  `);
  return result.rows.length;
}

async function lockProductLogQuota(transaction: ApiDatabaseTransaction): Promise<ProductLogQuotaRow> {
  const [quota] = await transaction
    .select({ usedBytes: productLogStoreQuota.usedBytes })
    .from(productLogStoreQuota)
    .where(eq(productLogStoreQuota.id, 'global'))
    .for('update');
  if (quota === undefined) {
    throw new Error('Product log store quota is not initialized.');
  }
  return quota;
}

function toInsertValues(event: InsertProductLogInput): typeof deploymentProductLogs.$inferInsert {
  return {
    capturedAt: new Date(),
    containerName: event.containerName,
    ...('deploymentId' in event ? { deploymentId: event.deploymentId } : { resourceId: event.resourceId }),
    message: event.message,
    namespace: event.namespace,
    occurredAt: new Date(event.timestamp),
    podName: event.podName,
    podUid: event.podUid,
    restartIdentity: event.restartIdentity,
    sourceFingerprint: event.sourceFingerprint,
    sourceOffset: event.sourceOffset,
    stream: event.stream as 'stdout' | 'stderr',
  };
}

function productLogReadPredicate(input: ListDeploymentProductLogsInput): SQL | undefined {
  const deploymentPredicate: SQL = inArray(deploymentProductLogs.deploymentId, input.deploymentIds);
  return input.since === undefined
    ? deploymentPredicate
    : and(deploymentPredicate, gte(deploymentProductLogs.occurredAt, input.since));
}
