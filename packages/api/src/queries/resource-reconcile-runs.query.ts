import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { ResourceClaimIdentity, ResourceReconcileIntent } from '@compartment/contracts';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { environments, projectKubeProvisioning, projectResources, resourceReconcileRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  AcknowledgeResourceReconcileRunInput,
  ClaimedResourceReconcileRun,
  CreateResourceReconcileRunInput,
  ResourceReconcileRunState,
} from './resource-reconcile-runs.query.types';

export async function createResourceReconcileRun(input: CreateResourceReconcileRunInput): Promise<void> {
  await getApiDatabase().transaction(
    async (tx: ApiDatabaseTransaction): Promise<void> => await createResourceReconcileRunWithExecutor(tx, input),
  );
}

export async function readResourceReconcileRunState(operationId: string): Promise<ResourceReconcileRunState | null> {
  const [row] = await getApiDatabase()
    .select({ failureMessage: resourceReconcileRuns.failureMessage, phase: resourceReconcileRuns.phase })
    .from(resourceReconcileRuns)
    .where(eq(resourceReconcileRuns.id, operationId))
    .limit(1);
  return row ?? null;
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
  const resourceId: string | undefined = await lockNextClaimableResource(tx);
  if (resourceId === undefined) {
    return null;
  }
  const row: typeof resourceReconcileRuns.$inferSelect | undefined = await selectClaimableResourceReconcileRun(
    tx,
    resourceId,
  );
  if (row === undefined) {
    return null;
  }
  const leaseId: string = randomUUID();
  const [claimed] = await tx
    .update(resourceReconcileRuns)
    .set({ leaseExpiresAt: new Date(Date.now() + 5 * 60_000), leaseId, phase: 'running', updatedAt: new Date() })
    .where(and(eq(resourceReconcileRuns.id, row.id), claimableResourceReconcileCondition()))
    .returning();
  return claimed === undefined ? null : buildClaimedResourceReconcileRun(claimed, leaseId);
}

async function lockNextClaimableResource(tx: ApiDatabaseTransaction): Promise<string | undefined> {
  const [selected] = await tx
    .select({ resourceId: projectResources.id })
    .from(resourceReconcileRuns)
    .innerJoin(projectResources, eq(projectResources.id, resourceReconcileRuns.projectResourceId))
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .innerJoin(projectKubeProvisioning, eq(projectKubeProvisioning.projectId, environments.projectId))
    .where(and(eq(projectKubeProvisioning.state, 'succeeded'), claimableResourceReconcileCondition()))
    .orderBy(asc(resourceReconcileRuns.createdAt), asc(resourceReconcileRuns.id))
    .limit(1)
    .for('update', { of: projectResources, skipLocked: true });
  return selected?.resourceId;
}

async function selectClaimableResourceReconcileRun(
  tx: ApiDatabaseTransaction,
  resourceId: string,
): Promise<typeof resourceReconcileRuns.$inferSelect | undefined> {
  const [selected] = await tx
    .select({ run: resourceReconcileRuns })
    .from(resourceReconcileRuns)
    .innerJoin(projectResources, eq(projectResources.id, resourceReconcileRuns.projectResourceId))
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .innerJoin(projectKubeProvisioning, eq(projectKubeProvisioning.projectId, environments.projectId))
    .where(
      and(
        eq(resourceReconcileRuns.projectResourceId, resourceId),
        eq(projectKubeProvisioning.state, 'succeeded'),
        claimableResourceReconcileCondition(),
      ),
    )
    .orderBy(asc(resourceReconcileRuns.createdAt), asc(resourceReconcileRuns.id))
    .limit(1);
  return selected?.run;
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
  await persistCompletedResourceState(tx, run, input);
}

async function persistCompletedResourceState(
  tx: ApiDatabaseTransaction,
  run: typeof resourceReconcileRuns.$inferSelect,
  input: AcknowledgeResourceReconcileRunInput,
): Promise<void> {
  if (run.operationType === 'bootstrap' && input.status === 'succeeded' && input.expectedClaims !== undefined) {
    await persistBootstrapCompletion(tx, run, input.expectedClaims);
  }
  if (run.operationType === 'reconcile' && input.status === 'succeeded') {
    await persistReconcileCompletion(tx, run);
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

async function persistReconcileCompletion(
  tx: ApiDatabaseTransaction,
  run: typeof resourceReconcileRuns.$inferSelect,
): Promise<void> {
  const intent: ResourceReconcileIntent = JSON.parse(run.intentJson) as ResourceReconcileIntent;
  await tx
    .update(projectResources)
    .set({ status: intent.replicas === 0 ? 'stopped' : 'running', updatedAt: new Date() })
    .where(eq(projectResources.id, run.projectResourceId));
}
