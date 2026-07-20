import { and, desc, eq } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { resourceReconcileRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { persistCompletedResourceState } from './resource-reconcile-completion.query';
import { lockProjectResourceForReconcile } from './resource-reconcile-lock.query';
import { resourceReconcileLeaseDurationMs } from './resource-reconcile-policy';
import { lockResourceReconcileProject } from './resource-reconcile-project.query';
import type {
  AcknowledgeResourceReconcileRunInput,
  ResourceReconcileProjectLockRow,
  ResourceReconcileRunLockRow,
} from './resource-reconcile-runs.query.types';
import { failDesiredDeploymentsWaitingForResource } from './deployment-resource-readiness-failure.query';

export async function acknowledgeResourceReconcileRun(input: AcknowledgeResourceReconcileRunInput): Promise<void> {
  await getApiDatabase().transaction(
    async (tx: ApiDatabaseTransaction): Promise<void> => await acknowledgeWithTransaction(tx, input),
  );
}

async function acknowledgeWithTransaction(
  tx: ApiDatabaseTransaction,
  input: AcknowledgeResourceReconcileRunInput,
): Promise<void> {
  const resourceId: string | undefined = await findAcknowledgementResourceId(tx, input);
  if (resourceId === undefined) {
    return;
  }
  const project: ResourceReconcileProjectLockRow = await lockResourceReconcileProject(tx, resourceId);
  await lockProjectResourceForReconcile(tx, resourceId);
  const run: typeof resourceReconcileRuns.$inferSelect | undefined = await lockAcknowledgedRun(tx, input);
  if (run === undefined) {
    return;
  }
  await persistResourceReconcileAcknowledgement(tx, input);
  await persistCompletedResourceState(tx, run, input, project.archivedAt !== null);
  if (input.status === 'failed' && (await isLatestResourceReconcileRun(tx, run))) {
    await failDesiredDeploymentsWaitingForResource(
      tx,
      resourceId,
      `Resource ${resourceId} reconcile failed: ${input.failureMessage ?? 'unknown failure'}`,
      new Date(),
    );
  }
}

async function isLatestResourceReconcileRun(
  tx: ApiDatabaseTransaction,
  acknowledgedRun: typeof resourceReconcileRuns.$inferSelect,
): Promise<boolean> {
  const [latest] = await tx
    .select({ id: resourceReconcileRuns.id })
    .from(resourceReconcileRuns)
    .where(eq(resourceReconcileRuns.projectResourceId, acknowledgedRun.projectResourceId))
    .orderBy(desc(resourceReconcileRuns.createdAt), desc(resourceReconcileRuns.id))
    .limit(1);
  return latest?.id === acknowledgedRun.id;
}

async function lockAcknowledgedRun(
  tx: ApiDatabaseTransaction,
  input: AcknowledgeResourceReconcileRunInput,
): Promise<typeof resourceReconcileRuns.$inferSelect | undefined> {
  const [run] = await tx
    .select()
    .from(resourceReconcileRuns)
    .where(
      and(
        eq(resourceReconcileRuns.id, input.operationId),
        eq(resourceReconcileRuns.leaseId, input.leaseId),
        eq(resourceReconcileRuns.phase, 'running'),
      ),
    )
    .for('update');
  return run;
}

async function findAcknowledgementResourceId(
  tx: ApiDatabaseTransaction,
  input: AcknowledgeResourceReconcileRunInput,
): Promise<string | undefined> {
  const [row]: ResourceReconcileRunLockRow[] = await tx
    .select({ projectResourceId: resourceReconcileRuns.projectResourceId })
    .from(resourceReconcileRuns)
    .where(
      and(
        eq(resourceReconcileRuns.id, input.operationId),
        eq(resourceReconcileRuns.leaseId, input.leaseId),
        eq(resourceReconcileRuns.phase, 'running'),
      ),
    )
    .limit(1);
  return row?.projectResourceId;
}

async function persistResourceReconcileAcknowledgement(
  tx: ApiDatabaseTransaction,
  input: AcknowledgeResourceReconcileRunInput,
): Promise<void> {
  await tx
    .update(resourceReconcileRuns)
    .set({
      ...(input.expectedClaims === undefined ? {} : { expectedClaimsJson: JSON.stringify(input.expectedClaims) }),
      failureMessage: input.failureMessage ?? null,
      phase: input.status,
      leaseExpiresAt: input.status === 'running' ? nextResourceReconcileLease() : null,
      ...(input.previousManifestJson === undefined ? {} : { previousManifestJson: input.previousManifestJson }),
      updatedAt: new Date(),
    })
    .where(eq(resourceReconcileRuns.id, input.operationId));
}

function nextResourceReconcileLease(): Date {
  return new Date(Date.now() + resourceReconcileLeaseDurationMs);
}
