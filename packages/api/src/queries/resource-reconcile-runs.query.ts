import { randomUUID } from 'node:crypto';
import type { ResourceClaimIdentity, ResourceReconcileIntent } from '@compartment/contracts';
import { and, asc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { environments, projectKubeProvisioning, projectResources, projects, resourceReconcileRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  AcknowledgeResourceReconcileRunInput,
  ClaimableResourceReconcileRunLockRow,
  ClaimedResourceReconcileRun,
  ResourceReconcileProjectLockRow,
  ResourceReconcileRunLockRow,
  ResourceReconcileRunState,
} from './resource-reconcile-runs.query.types';
import { persistCompletedResourceState } from './resource-reconcile-completion.query';
import { claimableResourceProjectCondition, lockResourceReconcileProject } from './resource-reconcile-project.query';

export async function readResourceReconcileRunState(operationId: string): Promise<ResourceReconcileRunState | null> {
  const [row] = await getApiDatabase()
    .select({ failureMessage: resourceReconcileRuns.failureMessage, phase: resourceReconcileRuns.phase })
    .from(resourceReconcileRuns)
    .where(eq(resourceReconcileRuns.id, operationId))
    .limit(1);
  return row ?? null;
}

export async function claimResourceReconcileRun(): Promise<ClaimedResourceReconcileRun | null> {
  return await getApiDatabase().transaction(claimResourceReconcileRunWithTransaction);
}

async function claimResourceReconcileRunWithTransaction(
  tx: ApiDatabaseTransaction,
): Promise<ClaimedResourceReconcileRun | null> {
  const candidate: ClaimableResourceReconcileRunLockRow | undefined = await lockNextClaimableResourceReconcileRun(tx);
  if (candidate === undefined) {
    return null;
  }
  const leaseId: string = randomUUID();
  const [claimed] = await tx
    .update(resourceReconcileRuns)
    .set({ leaseExpiresAt: new Date(Date.now() + 5 * 60_000), leaseId, phase: 'running', updatedAt: new Date() })
    .where(and(eq(resourceReconcileRuns.id, candidate.runId), claimableResourceReconcileCondition()))
    .returning();
  return claimed === undefined ? null : buildClaimedResourceReconcileRun(claimed, leaseId);
}

async function lockNextClaimableResourceReconcileRun(
  tx: ApiDatabaseTransaction,
): Promise<ClaimableResourceReconcileRunLockRow | undefined> {
  const [selected]: ClaimableResourceReconcileRunLockRow[] = await tx
    .select({ runId: resourceReconcileRuns.id })
    .from(resourceReconcileRuns)
    .innerJoin(projectResources, eq(projectResources.id, resourceReconcileRuns.projectResourceId))
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .innerJoin(projectKubeProvisioning, eq(projectKubeProvisioning.projectId, environments.projectId))
    .where(
      and(
        eq(projectKubeProvisioning.state, 'succeeded'),
        claimableResourceProjectCondition(),
        claimableResourceReconcileCondition(),
      ),
    )
    .orderBy(asc(resourceReconcileRuns.createdAt), asc(resourceReconcileRuns.id))
    .limit(1)
    .for('update', { of: projectResources, skipLocked: true });
  return selected;
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
  const resourceId: string | undefined = await findAcknowledgementResourceId(tx, input);
  if (resourceId === undefined) {
    return;
  }
  const project: ResourceReconcileProjectLockRow = await lockResourceReconcileProject(tx, resourceId);
  await lockProjectResource(tx, resourceId);
  const run: typeof resourceReconcileRuns.$inferSelect | undefined = await lockAcknowledgedRun(tx, input);
  if (run === undefined) {
    return;
  }
  await persistResourceReconcileAcknowledgement(tx, input);
  await persistCompletedResourceState(tx, run, input, project.archivedAt !== null);
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

async function lockProjectResource(tx: ApiDatabaseTransaction, resourceId: string): Promise<void> {
  await tx
    .select({ id: projectResources.id })
    .from(projectResources)
    .where(eq(projectResources.id, resourceId))
    .for('update');
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
