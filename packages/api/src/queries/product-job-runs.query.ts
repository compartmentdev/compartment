import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import type {
  ProductJobClass,
  ProductJobIntent,
  ProductJobVolumeMount,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { productJobRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  ClaimedProductJobQueryResult,
  PersistProductJobResultInput,
  ProductJobCommonSpec,
  ProductJobRunRow,
  ProductJobResultRow,
} from './product-job-runs.query.types';
import { lockProductJobResourceFence, prepareProductJobClaim } from './product-job-claim.query';
import { releaseProductJobReady } from './release-product-job-readiness.query';

interface ProductJobRunSelection extends SelectedFields {
  commandJson: typeof productJobRuns.commandJson;
  completedAt: typeof productJobRuns.completedAt;
  createdAt: typeof productJobRuns.createdAt;
  envJson: typeof productJobRuns.envJson;
  exitCode: typeof productJobRuns.exitCode;
  id: typeof productJobRuns.id;
  identityId: typeof productJobRuns.identityId;
  image: typeof productJobRuns.image;
  imagePullSecretId: typeof productJobRuns.imagePullSecretId;
  jobClass: typeof productJobRuns.jobClass;
  jobName: typeof productJobRuns.jobName;
  logs: typeof productJobRuns.logs;
  namespace: typeof productJobRuns.namespace;
  podName: typeof productJobRuns.podName;
  projectId: typeof productJobRuns.projectId;
  resourceIdsJson: typeof productJobRuns.resourceIdsJson;
  status: typeof productJobRuns.status;
  timeoutMs: typeof productJobRuns.timeoutMs;
  updatedAt: typeof productJobRuns.updatedAt;
  volumeMountsJson: typeof productJobRuns.volumeMountsJson;
}

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

async function claimProductJobWithTransaction(
  transaction: ApiDatabaseTransaction,
  jobClass: ProductJobClass,
): Promise<ClaimedProductJobQueryResult> {
  const row: ProductJobRunRow | undefined = await readClaimableProductJobRow(transaction, jobClass);
  if (row === undefined || !(await lockProductJobResourceFence(transaction, row))) {
    return { intent: null, persistedResult: null };
  }
  if (row.status === 'queued' && !(await transitionQueuedProductJob(transaction, row))) {
    return { intent: null, persistedResult: null };
  }
  return { intent: buildProductJobIntent(row), persistedResult: buildPersistedProductJobResult(row) };
}

async function transitionQueuedProductJob(
  transaction: ApiDatabaseTransaction,
  row: ProductJobRunRow,
): Promise<boolean> {
  const transitioned: { id: string }[] = await transaction
    .update(productJobRuns)
    .set({ status: 'running', updatedAt: new Date() })
    .where(
      and(
        eq(productJobRuns.jobClass, row.jobClass),
        eq(productJobRuns.identityId, row.identityId),
        eq(productJobRuns.status, 'queued'),
        row.jobClass === 'release' ? releaseProductJobReady(transaction) : undefined,
      ),
    )
    .returning({ id: productJobRuns.id });
  return transitioned.length > 0;
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
  jobName: productJobRuns.jobName,
  logs: productJobRuns.logs,
  namespace: productJobRuns.namespace,
  podName: productJobRuns.podName,
  projectId: productJobRuns.projectId,
  resourceIdsJson: productJobRuns.resourceIdsJson,
  status: productJobRuns.status,
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
    : {
        ...spec,
        jobClass: 'resource-operation',
        operationId: row.identityId,
        resourceIds: JSON.parse(row.resourceIdsJson) as string[],
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
