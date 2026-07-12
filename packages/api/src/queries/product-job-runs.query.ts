import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { ProductJobClass, ProductJobIntent, WorkerPersistProductJobResultRequest } from '@compartment/contracts';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { productJobRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  ClaimedProductJobQueryResult,
  PersistProductJobIntentInput,
  PersistProductJobResultInput,
  ProductJobCommonSpec,
  ProductJobRunRow,
} from './product-job-runs.query.types';

export async function persistProductJobIntent(input: PersistProductJobIntentInput): Promise<void> {
  await getApiDatabase()
    .insert(productJobRuns)
    .values({
      commandJson: JSON.stringify(input.intent.command),
      envJson: JSON.stringify(input.intent.env),
      id: `job_${randomUUID().replaceAll('-', '')}`,
      identityId: input.identityId,
      image: input.intent.image,
      jobClass: input.intent.jobClass,
      namespace: input.intent.namespace,
      status: 'queued',
      timeoutMs: input.intent.timeoutMs,
    })
    .onConflictDoNothing({ target: [productJobRuns.jobClass, productJobRuns.identityId] });
}

export async function claimProductJob(): Promise<ClaimedProductJobQueryResult> {
  return await getApiDatabase().transaction(claimProductJobWithTransaction);
}

async function claimProductJobWithTransaction(
  transaction: ApiDatabaseTransaction,
): Promise<ClaimedProductJobQueryResult> {
  const row: ProductJobRunRow | undefined = await readClaimableProductJobRow(transaction);
  if (row === undefined) {
    return { intent: null, persistedResult: null };
  }
  if (row.status === 'queued' || row.status === 'running') {
    await transaction
      .update(productJobRuns)
      .set({ status: 'running', updatedAt: new Date() })
      .where(and(eq(productJobRuns.jobClass, row.jobClass), eq(productJobRuns.identityId, row.identityId)));
  }
  return { intent: buildProductJobIntent(row), persistedResult: buildPersistedProductJobResult(row) };
}

async function readClaimableProductJobRow(transaction: ApiDatabaseTransaction): Promise<ProductJobRunRow | undefined> {
  const [row] = await transaction
    .select({
      commandJson: productJobRuns.commandJson,
      completedAt: productJobRuns.completedAt,
      createdAt: productJobRuns.createdAt,
      envJson: productJobRuns.envJson,
      exitCode: productJobRuns.exitCode,
      identityId: productJobRuns.identityId,
      image: productJobRuns.image,
      jobClass: productJobRuns.jobClass,
      jobName: productJobRuns.jobName,
      logs: productJobRuns.logs,
      namespace: productJobRuns.namespace,
      podName: productJobRuns.podName,
      status: productJobRuns.status,
      timeoutMs: productJobRuns.timeoutMs,
    })
    .from(productJobRuns)
    .where(claimableProductJobPredicate())
    .orderBy(asc(productJobRuns.createdAt))
    .limit(1)
    .for('update', { skipLocked: true });
  return row;
}

function claimableProductJobPredicate(): SQL | undefined {
  return or(
    inArray(productJobRuns.status, ['queued', 'running']),
    and(inArray(productJobRuns.status, ['succeeded', 'failed', 'timed-out']), isNull(productJobRuns.finalizedAt)),
  );
}

function buildPersistedProductJobResult(row: ProductJobRunRow): WorkerPersistProductJobResultRequest | null {
  if (row.status === 'queued' || row.status === 'running') {
    return null;
  }
  if (row.completedAt === null || row.jobName === null || row.logs === null) {
    throw new Error(`Product Job ${row.jobClass}/${row.identityId} has incomplete terminal evidence.`);
  }
  return {
    completedAt: row.completedAt.toISOString(),
    exitCode: row.exitCode,
    identityId: row.identityId,
    jobClass: row.jobClass,
    jobName: row.jobName,
    logs: row.logs,
    podName: row.podName,
    status: row.status,
  };
}

export async function persistProductJobResult(input: PersistProductJobResultInput): Promise<void> {
  await getApiDatabase()
    .update(productJobRuns)
    .set({
      completedAt: new Date(input.completedAt),
      exitCode: input.exitCode,
      jobName: input.jobName,
      logs: input.logs,
      podName: input.podName,
      status: input.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(productJobRuns.jobClass, input.jobClass),
        eq(productJobRuns.identityId, input.identityId),
        inArray(productJobRuns.status, ['queued', 'running']),
      ),
    );
}

export async function persistProductJobFinalized(jobClass: ProductJobClass, identityId: string): Promise<void> {
  await getApiDatabase()
    .update(productJobRuns)
    .set({ finalizedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(productJobRuns.jobClass, jobClass), eq(productJobRuns.identityId, identityId)));
}

function buildProductJobIntent(row: ProductJobRunRow): ProductJobIntent {
  const spec: ProductJobCommonSpec = {
    command: JSON.parse(row.commandJson) as string[],
    env: JSON.parse(row.envJson) as Record<string, string>,
    image: row.image,
    namespace: row.namespace,
    timeoutMs: Math.max(1, row.createdAt.getTime() + row.timeoutMs - Date.now()),
  };
  return row.jobClass === 'release'
    ? { ...spec, deploymentId: row.identityId, jobClass: 'release' }
    : { ...spec, jobClass: 'resource-operation', operationId: row.identityId };
}
