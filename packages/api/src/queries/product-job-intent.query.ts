import { randomUUID } from 'node:crypto';
import type { WorkerPersistProductJobResultRequest } from '@compartment/contracts';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { productJobRuns, projects } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { readProductJobResult } from './product-job-runs.query';
import type { PersistProductJobIntentInput } from './product-job-runs.query.types';
import { cancelInvalidReleaseProductJob } from './release-product-job-readiness.query';

export async function persistProductJobIntent(
  input: PersistProductJobIntentInput,
): Promise<WorkerPersistProductJobResultRequest | null> {
  const canceled: WorkerPersistProductJobResultRequest | null = await getApiDatabase().transaction(
    async (tx: ApiDatabaseTransaction): Promise<WorkerPersistProductJobResultRequest | null> =>
      await persistProductJobIntentWithExecutor(tx, input),
  );
  return canceled ?? (await readProductJobResult(input.intent.jobClass, input.identityId));
}

async function persistProductJobIntentWithExecutor(
  tx: ApiDatabaseTransaction,
  input: PersistProductJobIntentInput,
): Promise<WorkerPersistProductJobResultRequest | null> {
  const canceledAt: Date | null = await readProductJobCancellationTime(tx, input.intent.projectId);
  const canceled: WorkerPersistProductJobResultRequest | null =
    canceledAt === null ? null : archivedProductJobResult(input, canceledAt);
  await insertProductJobIntent(tx, input, canceled);
  if (input.intent.jobClass === 'release' && canceled === null) {
    await cancelInvalidReleaseProductJob(tx, new Date(), input.intent.deploymentId);
  }
  return canceled;
}

async function readProductJobCancellationTime(
  executor: Database | ApiDatabaseTransaction,
  projectId: string,
): Promise<Date | null> {
  const [project] = await executor
    .select({ archivedAt: projects.archivedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
    .for('key share');
  if (project?.archivedAt === null) {
    return null;
  }
  return new Date();
}

async function insertProductJobIntent(
  tx: ApiDatabaseTransaction,
  input: PersistProductJobIntentInput,
  canceled: WorkerPersistProductJobResultRequest | null,
): Promise<void> {
  await tx
    .insert(productJobRuns)
    .values(productJobIntentValues(input, canceled))
    .onConflictDoNothing({ target: [productJobRuns.jobClass, productJobRuns.identityId] });
}

function productJobIntentValues(
  input: PersistProductJobIntentInput,
  canceled: WorkerPersistProductJobResultRequest | null,
): typeof productJobRuns.$inferInsert {
  return {
    commandJson: JSON.stringify(input.intent.command),
    completedAt: canceled === null ? null : new Date(canceled.completedAt),
    envJson: JSON.stringify(input.intent.env),
    id: `job_${randomUUID().replaceAll('-', '')}`,
    identityId: input.identityId,
    image: input.intent.image,
    imagePullSecretId: input.intent.jobClass === 'release' ? input.intent.imagePullSecretId : null,
    jobClass: input.intent.jobClass,
    jobName: canceled?.jobName ?? null,
    logs: canceled?.logs ?? null,
    namespace: input.intent.namespace,
    podName: null,
    projectId: input.intent.projectId,
    resourceIdsJson: JSON.stringify(input.intent.jobClass === 'resource-operation' ? input.intent.resourceIds : []),
    status: canceled?.status ?? 'queued',
    timeoutMs: input.intent.timeoutMs,
    volumeMountsJson: JSON.stringify(input.intent.volumeMounts ?? []),
  };
}

function archivedProductJobResult(
  input: PersistProductJobIntentInput,
  canceledAt: Date,
): WorkerPersistProductJobResultRequest {
  return {
    completedAt: canceledAt.toISOString(),
    exitCode: null,
    identityId: input.identityId,
    jobClass: input.intent.jobClass,
    jobName: `archived-job/${input.identityId}`,
    logs: 'Product Job canceled because its project was archived or deleted.',
    podName: null,
    status: 'timed-out',
  };
}
