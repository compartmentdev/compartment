import { and, eq, inArray } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { productJobRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { recordJobUsage } from './job-usage.query';
import type { PersistProductJobResultInput } from './product-job-runs.query.types';

export async function persistProductJobResult(input: PersistProductJobResultInput): Promise<void> {
  await getApiDatabase().transaction(
    async (tx: ApiDatabaseTransaction): Promise<void> => await persistResultWithTransaction(tx, input),
  );
}

async function persistResultWithTransaction(
  tx: ApiDatabaseTransaction,
  input: PersistProductJobResultInput,
): Promise<void> {
  const [row] = await tx
    .select({ startedAt: productJobRuns.startedAt })
    .from(productJobRuns)
    .where(and(eq(productJobRuns.jobClass, input.jobClass), eq(productJobRuns.identityId, input.identityId)))
    .limit(1);
  const accepted: boolean = await updateProductJobResult(tx, input);
  if (accepted && input.jobClass === 'release' && row?.startedAt !== null && row?.startedAt !== undefined) {
    await recordJobUsage(tx, {
      completedAt: new Date(input.completedAt),
      deploymentId: input.identityId,
      jobClass: 'release',
      sourceKey: `release:${input.identityId}`,
      startedAt: row.startedAt,
    });
  }
}

async function updateProductJobResult(
  tx: ApiDatabaseTransaction,
  input: PersistProductJobResultInput,
): Promise<boolean> {
  const updated: { id: string }[] = await tx
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
    )
    .returning({ id: productJobRuns.id });
  return updated.length > 0;
}
