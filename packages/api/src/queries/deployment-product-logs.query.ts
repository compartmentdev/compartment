import { and, asc, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import {
  deploymentKubeReferences,
  deploymentProductLogs,
  deployments,
  environments,
  projectResources,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { ApiDatabaseTransaction } from '../db/client.types';
import type {
  DeploymentLogIdentityRow,
  DeploymentProductLogLine,
  InsertDeploymentProductLogsResult,
  InsertProductLogInput,
  InsertedProductLogAppKey,
  ListDeploymentProductLogsInput,
  ListResourceProductLogsInput,
  ResourceLogIdentityRow,
  ResourceProductLogLine,
} from './deployment-product-logs.query.types';

const productLogRetainedLinesPerApp: number = 1_000;

const productLogAppLockSalt: number = 92_317;

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

export async function listResourceLogIdentities(resourceIds: string[]): Promise<ResourceLogIdentityRow[]> {
  if (resourceIds.length === 0) {
    return [];
  }
  return await getApiDatabase()
    .select({
      namespaceId: environments.projectId,
      resourceId: projectResources.id,
    })
    .from(projectResources)
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .where(inArray(projectResources.id, resourceIds))
    .orderBy(asc(projectResources.id));
}

export async function insertDeploymentProductLogs(
  events: InsertProductLogInput[],
): Promise<InsertDeploymentProductLogsResult> {
  if (events.length === 0) {
    return { attempted: 0, inserted: 0 };
  }
  return await getApiDatabase().transaction(
    async (transaction: ApiDatabaseTransaction): Promise<InsertDeploymentProductLogsResult> =>
      await insertProductLogsWithinAppWindows(transaction, events),
  );
}

async function insertProductLogsWithinAppWindows(
  transaction: ApiDatabaseTransaction,
  events: InsertProductLogInput[],
): Promise<InsertDeploymentProductLogsResult> {
  await lockProductLogApps(transaction, events.map(eventAppKey));
  const inserted: InsertedProductLogAppKey[] = await transaction
    .insert(deploymentProductLogs)
    .values(events.map(toInsertValues))
    .onConflictDoNothing()
    .returning({ appKey: deploymentProductLogs.appKey });
  await trimProductLogAppWindows(transaction, orderedAppKeys(inserted.map(eventAppKey)));
  return { attempted: events.length, inserted: inserted.length };
}

/**
 * Serializes concurrent ingest batches per app so their retention windows cannot interleave.
 * Apps hash to effectively distinct locks, so organizations never wait on each other.
 *
 * One awaited statement per key, because a set-returning form leaves the acquisition order to the
 * executor. Overlapping batches must take shared keys in the same order, or they deadlock.
 */
async function lockProductLogApps(transaction: ApiDatabaseTransaction, appKeys: string[]): Promise<void> {
  for (const appKey of orderedAppKeys(appKeys)) {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${appKey}, ${productLogAppLockSalt}))`);
  }
}

/**
 * Drops every line beyond the newest `productLogRetainedLinesPerApp` of each app. Ranking is bounded
 * to the touched apps by the `app_key` index, so the table is never scanned.
 */
async function trimProductLogAppWindows(transaction: ApiDatabaseTransaction, appKeys: string[]): Promise<void> {
  if (appKeys.length === 0) {
    return;
  }
  await transaction.execute(sql`
    with ranked as (
      select ${deploymentProductLogs}.ctid as line_ctid,
        row_number() over (
          partition by ${deploymentProductLogs.appKey}
          order by ${deploymentProductLogs.occurredAt} desc, ${deploymentProductLogs.sourceOffset} desc
        ) as line_rank
      from ${deploymentProductLogs}
      where ${inArray(deploymentProductLogs.appKey, appKeys)}
    )
    delete from ${deploymentProductLogs}
    where ctid in (select line_ctid from ranked where line_rank > ${productLogRetainedLinesPerApp})
  `);
}

function eventAppKey(row: InsertedProductLogAppKey): string {
  return row.appKey;
}

/**
 * Sorts by code unit rather than `localeCompare`, so every process derives the same lock order
 * regardless of its locale or ICU build. A locale-dependent order would let two replicas take the
 * same pair of app locks in opposite order and deadlock.
 */
function orderedAppKeys(appKeys: string[]): string[] {
  return [...new Set(appKeys)].sort((left: string, right: string): number => (left < right ? -1 : 1));
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

function toInsertValues(event: InsertProductLogInput): typeof deploymentProductLogs.$inferInsert {
  return {
    appKey: event.appKey,
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
