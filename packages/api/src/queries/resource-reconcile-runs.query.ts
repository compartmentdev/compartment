import { randomUUID } from 'node:crypto';
import type { ResourceClaimIdentity, ResourceReconcileIntent } from '@compartment/contracts';
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import {
  environments,
  productJobRuns,
  projectKubeProvisioning,
  projectResources,
  projects,
  resourceReconcileRuns,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  ClaimableResourceReconcileRunLockRow,
  ClaimedResourceReconcileRun,
  ResourceBootstrapSettlement,
  ResourceReconcileSettlement,
  ResourceReconcileSettlementRow,
  ResourceReconcileSettlementSelection,
  ResourceReconcileRunState,
} from './resource-reconcile-runs.query.types';
import { claimableResourceProjectCondition } from './resource-reconcile-project.query';
import { lockProjectResourceForReconcile } from './resource-reconcile-lock.query';
import { resourceReconcileLeaseDurationMs } from './resource-reconcile-policy';
import { toProjectResourceRow } from './resources.query';
import { lockResourceRuntimeClaims } from './resource-runtime-claim-lock.query';
import { projectIsolationVersion } from './project-provisioning-policy';

export { acknowledgeResourceReconcileRun } from './resource-reconcile-acknowledgement.query';
const resourceReconcileSettlementSelection: ResourceReconcileSettlementSelection = {
  provisioningAttempts: projectKubeProvisioning.attempts,
  provisioningState: projectKubeProvisioning.state,
  resource: projectResources,
  state: {
    operationId: resourceReconcileRuns.id,
    failureMessage: resourceReconcileRuns.failureMessage,
    phase: resourceReconcileRuns.phase,
  },
};

export async function readResourceReconcileRunState(operationId: string): Promise<ResourceReconcileRunState | null> {
  const [row] = await getApiDatabase()
    .select({ failureMessage: resourceReconcileRuns.failureMessage, phase: resourceReconcileRuns.phase })
    .from(resourceReconcileRuns)
    .where(eq(resourceReconcileRuns.id, operationId))
    .limit(1);
  return row ?? null;
}

export async function readResourceBootstrapSettlement(
  projectResourceId: string,
): Promise<ResourceBootstrapSettlement | null> {
  return await readResourceRunSettlement(projectResourceId, 'bootstrap');
}

export async function readResourceReconcileSettlement(
  projectResourceId: string,
): Promise<ResourceReconcileSettlement | null> {
  return await readResourceRunSettlement(projectResourceId, 'reconcile');
}

async function readResourceRunSettlement(
  projectResourceId: string,
  operationType: 'bootstrap' | 'reconcile',
): Promise<ResourceReconcileSettlement | null> {
  const [row]: ResourceReconcileSettlementRow[] = await getApiDatabase()
    .select(resourceReconcileSettlementSelection)
    .from(projectResources)
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .innerJoin(projectKubeProvisioning, eq(projectKubeProvisioning.projectId, environments.projectId))
    .leftJoin(
      resourceReconcileRuns,
      and(
        eq(resourceReconcileRuns.projectResourceId, projectResources.id),
        eq(resourceReconcileRuns.operationType, operationType),
      ),
    )
    .where(eq(projectResources.id, projectResourceId))
    .orderBy(desc(resourceReconcileRuns.createdAt), desc(resourceReconcileRuns.id))
    .limit(1);
  return row === undefined ? null : toResourceReconcileSettlement(row);
}

function toResourceReconcileSettlement(row: ResourceReconcileSettlementRow): ResourceReconcileSettlement {
  return {
    provisioningAttempts: row.provisioningAttempts,
    provisioningState: row.provisioningState,
    resource: toProjectResourceRow(row.resource),
    state: row.state,
  };
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
  await lockResourceRuntimeClaims(tx, [candidate.projectResourceId]);
  await lockProjectResourceForReconcile(tx, candidate.projectResourceId);
  const leaseId: string = randomUUID();
  const [claimed] = await tx
    .update(resourceReconcileRuns)
    .set({ leaseExpiresAt: nextResourceReconcileLease(), leaseId, phase: 'running', updatedAt: new Date() })
    .where(and(eq(resourceReconcileRuns.id, candidate.runId), claimableResourceReconcileRunCondition()))
    .returning();
  return claimed === undefined ? null : buildClaimedResourceReconcileRun(claimed, leaseId);
}

async function lockNextClaimableResourceReconcileRun(
  tx: ApiDatabaseTransaction,
): Promise<ClaimableResourceReconcileRunLockRow | undefined> {
  const [selected]: ClaimableResourceReconcileRunLockRow[] = await tx
    .select({ projectResourceId: projectResources.id, runId: resourceReconcileRuns.id })
    .from(resourceReconcileRuns)
    .innerJoin(projectResources, eq(projectResources.id, resourceReconcileRuns.projectResourceId))
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .innerJoin(projectKubeProvisioning, eq(projectKubeProvisioning.projectId, environments.projectId))
    .where(
      and(
        eq(projectKubeProvisioning.state, 'succeeded'),
        eq(projectKubeProvisioning.isolationVersion, projectIsolationVersion),
        claimableResourceProjectCondition(),
        claimableResourceReconcileCondition(),
      ),
    )
    .orderBy(asc(resourceReconcileRuns.createdAt), asc(resourceReconcileRuns.id))
    .limit(1)
    .for('no key update', { of: projects, skipLocked: true });
  return selected;
}

function claimableResourceReconcileCondition(): SQL | undefined {
  return and(claimableResourceStateCondition(), claimableResourceReconcileRunCondition());
}

function claimableResourceStateCondition(): SQL | undefined {
  return or(
    ne(projectResources.status, 'deleting'),
    eq(resourceReconcileRuns.operationType, 'bootstrap'),
    claimableResourceDeletionCondition(),
  );
}

function claimableResourceReconcileRunCondition(): SQL | undefined {
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
    resourceReconcileProductJobFence(),
  );
}

function resourceReconcileProductJobFence(): SQL {
  return sql`not exists (
    select 1
    from ${productJobRuns}
    inner join jsonb_array_elements_text(${productJobRuns.resourceIdsJson}::jsonb) resource_ids(resource_id) on true
    where ${productJobRuns.jobClass} = 'resource-operation'
      and ${productJobRuns.finalizedAt} is null
      and resource_id = ${resourceReconcileRuns.projectResourceId}
      and (
        ${productJobRuns.status} <> 'queued'
        or (${productJobRuns.createdAt}, ${productJobRuns.id})
          < (${resourceReconcileRuns.createdAt}, ${resourceReconcileRuns.id})
      )
  )`;
}

function claimableResourceDeletionCondition(): SQL | undefined {
  return and(
    eq(resourceReconcileRuns.operationType, 'reconcile'),
    sql`${resourceReconcileRuns.intentJson}::jsonb ->> 'operation' = 'delete'`,
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

function nextResourceReconcileLease(): Date {
  return new Date(Date.now() + resourceReconcileLeaseDurationMs);
}
