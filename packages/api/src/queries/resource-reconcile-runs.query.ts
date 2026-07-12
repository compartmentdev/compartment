import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { ResourceClaimIdentity, ResourceReconcileIntent } from '@compartment/contracts';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { projectResources, resourceReconcileRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  AcknowledgeResourceReconcileRunInput,
  ClaimedResourceReconcileRun,
  CreateResourceReconcileRunInput,
} from './resource-reconcile-runs.query.types';

export async function createResourceReconcileRun(input: CreateResourceReconcileRunInput): Promise<void> {
  await getApiDatabase().transaction(
    async (tx: ApiDatabaseTransaction): Promise<void> => await createResourceReconcileRunWithExecutor(tx, input),
  );
}

export async function createResourceReconcileRunWithExecutor(
  executor: ApiDatabaseTransaction,
  input: CreateResourceReconcileRunInput,
): Promise<void> {
  await executor.insert(resourceReconcileRuns).values({
    expectedClaimsJson: JSON.stringify(input.expectedClaims),
    id: input.operationId,
    intentJson: JSON.stringify(input.intent),
    operationType: input.type,
    phase: input.type === 'bootstrap' ? 'bootstrap-pending' : 'reconcile-pending',
    projectResourceId: input.intent.resourceId,
  });
}

export async function claimResourceReconcileRun(): Promise<ClaimedResourceReconcileRun | null> {
  return await getApiDatabase().transaction(claimResourceReconcileRunWithTransaction);
}

async function claimResourceReconcileRunWithTransaction(
  tx: ApiDatabaseTransaction,
): Promise<ClaimedResourceReconcileRun | null> {
  const [selected] = await tx
    .select({ run: resourceReconcileRuns })
    .from(resourceReconcileRuns)
    .innerJoin(projectResources, eq(projectResources.id, resourceReconcileRuns.projectResourceId))
    .where(claimableResourceReconcileCondition())
    .orderBy(asc(resourceReconcileRuns.createdAt))
    .limit(1)
    .for('update', { of: projectResources, skipLocked: true });
  if (selected === undefined) {
    return null;
  }
  const row: typeof resourceReconcileRuns.$inferSelect = selected.run;
  const leaseId: string = randomUUID();
  await tx
    .update(resourceReconcileRuns)
    .set({ leaseExpiresAt: new Date(Date.now() + 5 * 60_000), leaseId, phase: 'running', updatedAt: new Date() })
    .where(eq(resourceReconcileRuns.id, row.id));
  return buildClaimedResourceReconcileRun(row, leaseId);
}

function claimableResourceReconcileCondition(): SQL | undefined {
  return and(
    or(
      inArray(resourceReconcileRuns.phase, ['bootstrap-pending', 'reconcile-pending']),
      and(
        eq(resourceReconcileRuns.phase, 'running'),
        or(isNull(resourceReconcileRuns.leaseExpiresAt), lt(resourceReconcileRuns.leaseExpiresAt, new Date())),
      ),
    ),
    sql`not exists (
      select 1 from "resource_reconcile_runs" active
      where active."project_resource_id" = ${resourceReconcileRuns.projectResourceId}
        and active."phase" = 'running'
        and active."lease_expires_at" > now()
    )`,
  );
}

function buildClaimedResourceReconcileRun(
  row: typeof resourceReconcileRuns.$inferSelect,
  leaseId: string,
): ClaimedResourceReconcileRun {
  return {
    expectedClaims: JSON.parse(row.expectedClaimsJson) as ResourceClaimIdentity[],
    intent: JSON.parse(row.intentJson) as ResourceReconcileIntent,
    operationId: row.id,
    leaseId,
    previousManifestJson: row.previousManifestJson,
    type: row.operationType,
  };
}

export async function acknowledgeResourceReconcileRun(input: AcknowledgeResourceReconcileRunInput): Promise<void> {
  await getApiDatabase().transaction(
    async (tx: ApiDatabaseTransaction): Promise<void> => await acknowledgeWithTransaction(tx, input),
  );
}

async function acknowledgeWithTransaction(
  tx: ApiDatabaseTransaction,
  input: AcknowledgeResourceReconcileRunInput,
): Promise<void> {
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
  if (run === undefined) {
    return;
  }
  await persistResourceReconcileAcknowledgement(tx, input);
  if (run.operationType === 'bootstrap' && input.status === 'succeeded' && input.expectedClaims !== undefined) {
    await persistBootstrapCompletion(tx, run, input.expectedClaims);
  }
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
      leaseExpiresAt: input.status === 'running' ? new Date(Date.now() + 5 * 60_000) : null,
      ...(input.previousManifestJson === undefined ? {} : { previousManifestJson: input.previousManifestJson }),
      updatedAt: new Date(),
    })
    .where(eq(resourceReconcileRuns.id, input.operationId));
}

async function persistBootstrapCompletion(
  tx: ApiDatabaseTransaction,
  run: typeof resourceReconcileRuns.$inferSelect,
  expectedClaims: ResourceClaimIdentity[],
): Promise<void> {
  await tx
    .update(projectResources)
    .set({ expectedClaimsJson: JSON.stringify(expectedClaims), updatedAt: new Date() })
    .where(eq(projectResources.id, run.projectResourceId));
  await tx.insert(resourceReconcileRuns).values({
    expectedClaimsJson: JSON.stringify(expectedClaims),
    id: `resource_operation_${randomUUID().replaceAll('-', '')}`,
    intentJson: run.intentJson,
    operationType: 'reconcile',
    phase: 'reconcile-pending',
    projectResourceId: run.projectResourceId,
  });
}
