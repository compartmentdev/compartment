import { and, asc, eq, type SQL } from 'drizzle-orm';
import type {
  ProductJobClass,
  ProductJobIntent,
  ProductJobVolumeMount,
  ResourceOperationProductJobIntent,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { productJobRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { claimSelectedRow } from './claim-row.query.shared';
import type {
  ClaimedProductJobQueryResult,
  ProductJobCommonSpec,
  ProductJobResourceFenceResult,
  ProductJobRunRow,
  ProductJobResultRow,
} from './product-job-runs.query.types';
import { lockProductJobResourceFence, prepareProductJobClaim } from './product-job-claim.query';

type ProductJobRunSelection = Pick<typeof productJobRuns, keyof ProductJobRunRow>;

export async function claimProductJob(jobClass: ProductJobClass): Promise<ClaimedProductJobQueryResult> {
  return await getApiDatabase().transaction(
    async (transaction: ApiDatabaseTransaction): Promise<ClaimedProductJobQueryResult> =>
      await claimProductJobWithTransaction(transaction, jobClass),
  );
}

export async function readProductJobResult(
  jobClass: ProductJobClass,
  identityId: string,
): Promise<WorkerPersistProductJobResultRequest | null> {
  return await readProductJobResultWithExecutor(getApiDatabase(), jobClass, identityId);
}

async function claimProductJobWithTransaction(
  transaction: ApiDatabaseTransaction,
  jobClass: ProductJobClass,
): Promise<ClaimedProductJobQueryResult> {
  return await claimSelectedRow(
    transaction,
    async (tx: ApiDatabaseTransaction): Promise<ProductJobRunRow | undefined> =>
      await readClaimableProductJobRow(tx, jobClass),
    claimLockedProductJob,
    { intent: null, persistedResult: null },
  );
}

async function claimLockedProductJob(
  transaction: ApiDatabaseTransaction,
  row: ProductJobRunRow,
): Promise<ClaimedProductJobQueryResult> {
  const fenceResult: ProductJobResourceFenceResult = await lockProductJobResourceFence(transaction, row);
  if (fenceResult === 'blocked') {
    return { intent: null, persistedResult: null };
  }
  if (fenceResult === 'terminalized') {
    return await buildTerminalizedProductJobClaim(transaction, row);
  }
  if (row.status === 'queued') {
    await markProductJobRunning(transaction, row);
  }
  return { intent: buildProductJobIntent(row), persistedResult: buildPersistedProductJobResult(row) };
}

async function markProductJobRunning(transaction: ApiDatabaseTransaction, row: ProductJobRunRow): Promise<void> {
  await transaction
    .update(productJobRuns)
    .set({ startedAt: new Date(), status: 'running', updatedAt: new Date() })
    .where(
      and(
        eq(productJobRuns.jobClass, row.jobClass),
        eq(productJobRuns.identityId, row.identityId),
        eq(productJobRuns.status, 'queued'),
      ),
    );
}

async function buildTerminalizedProductJobClaim(
  transaction: ApiDatabaseTransaction,
  row: ProductJobRunRow,
): Promise<ClaimedProductJobQueryResult> {
  const persistedResult: WorkerPersistProductJobResultRequest | null = await readProductJobResultWithExecutor(
    transaction,
    row.jobClass,
    row.identityId,
  );
  if (persistedResult === null) {
    throw new Error(`Terminalized Product Job ${row.jobClass}/${row.identityId} has no persisted result.`);
  }
  return { intent: buildProductJobIntent(row), persistedResult };
}

async function readProductJobResultWithExecutor(
  executor: ApiDatabaseTransaction | Database,
  jobClass: ProductJobClass,
  identityId: string,
): Promise<WorkerPersistProductJobResultRequest | null> {
  const [row] = await executor
    .select({
      completedAt: productJobRuns.completedAt,
      exitCode: productJobRuns.exitCode,
      identityId: productJobRuns.identityId,
      jobClass: productJobRuns.jobClass,
      jobName: productJobRuns.jobName,
      logs: productJobRuns.logs,
      podName: productJobRuns.podName,
      status: productJobRuns.status,
    })
    .from(productJobRuns)
    .where(and(eq(productJobRuns.jobClass, jobClass), eq(productJobRuns.identityId, identityId)))
    .limit(1);
  return row === undefined ? null : buildPersistedProductJobResult(row);
}

const claimableProductJobSelection: ProductJobRunSelection = {
  commandJson: productJobRuns.commandJson,
  completedAt: productJobRuns.completedAt,
  createdAt: productJobRuns.createdAt,
  envJson: productJobRuns.envJson,
  exitCode: productJobRuns.exitCode,
  id: productJobRuns.id,
  identityId: productJobRuns.identityId,
  image: productJobRuns.image,
  imagePullSecretId: productJobRuns.imagePullSecretId,
  jobClass: productJobRuns.jobClass,
  runtimeIdentity: productJobRuns.runtimeIdentity,
  jobName: productJobRuns.jobName,
  logs: productJobRuns.logs,
  namespace: productJobRuns.namespace,
  podName: productJobRuns.podName,
  projectId: productJobRuns.projectId,
  resourceIdsJson: productJobRuns.resourceIdsJson,
  status: productJobRuns.status,
  startedAt: productJobRuns.startedAt,
  timeoutMs: productJobRuns.timeoutMs,
  updatedAt: productJobRuns.updatedAt,
  volumeMountsJson: productJobRuns.volumeMountsJson,
};

async function readClaimableProductJobRow(
  transaction: ApiDatabaseTransaction,
  jobClass: ProductJobClass,
): Promise<ProductJobRunRow | undefined> {
  const claimable: SQL | undefined = await prepareProductJobClaim(transaction, jobClass);
  return (
    await transaction
      .select(claimableProductJobSelection)
      .from(productJobRuns)
      .where(and(eq(productJobRuns.jobClass, jobClass), claimable))
      .orderBy(asc(productJobRuns.createdAt), asc(productJobRuns.id))
      .limit(1)
      .for('update', { skipLocked: true })
  )[0];
}

function buildPersistedProductJobResult(row: ProductJobResultRow): WorkerPersistProductJobResultRequest | null {
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
    ...(row.imagePullSecretId === null ? {} : { imagePullSecretId: row.imagePullSecretId }),
    namespace: row.namespace,
    projectId: row.projectId,
    timeoutMs: productJobTimeoutMs(row),
    volumeMounts: JSON.parse(row.volumeMountsJson) as ProductJobVolumeMount[],
  };
  return row.jobClass === 'release'
    ? {
        ...spec,
        deploymentId: row.identityId,
        imagePullSecretId: requireReleaseImagePullSecretId(row),
        jobClass: 'release',
      }
    : buildResourceOperationProductJobIntent(row, spec);
}

function buildResourceOperationProductJobIntent(
  row: ProductJobRunRow,
  spec: ProductJobCommonSpec,
): ResourceOperationProductJobIntent {
  return {
    ...spec,
    jobClass: 'resource-operation',
    operationId: row.identityId,
    resourceIds: JSON.parse(row.resourceIdsJson) as string[],
    runtimeIdentity: row.runtimeIdentity,
  };
}

function productJobTimeoutMs(row: ProductJobRunRow): number {
  return row.status === 'queued' ? row.timeoutMs : Math.max(1, row.updatedAt.getTime() + row.timeoutMs - Date.now());
}

function requireReleaseImagePullSecretId(row: ProductJobRunRow): string {
  if (row.imagePullSecretId === null) {
    throw new Error(`Release product Job ${row.identityId} has no image pull secret.`);
  }
  return row.imagePullSecretId;
}
