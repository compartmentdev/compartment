import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { environments, operations, projectResources, projects, resourceReconcileRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { lockProjectResourceReconciliation } from './resources.query';
import type {
  ResourceDeletionDemandRow,
  ResourceDeletionFinalizationResult,
  ResourceDeletionOutcomeRow,
  ResourceDeletionOutcomeValues,
} from './resource-reconcile-deletion.query.types';
import type { ResourceDeletionRunState } from './resource-reconcile-runs.query.types';

const resourceDeletionOutcomeTargetType: string = 'resource-deletion-outcome';
const resourceDeleteDataOperationType: string = 'resource.delete-data';
const resourceRetainDataOperationType: string = 'resource.delete-retain-data';
export const resourceDeletionBindingOutcomeTargetType: string = 'resource-deletion-binding-outcome';
export const resourceDeletionBindingTargetSeparator: string = '/';

export async function readLatestResourceDeletionRun(resourceId: string): Promise<ResourceDeletionRunState | null> {
  return await readLatestResourceDeletionRunWithExecutor(getApiDatabase(), resourceId);
}

export async function finalizeProjectResourceDeletion(resourceId: string): Promise<ResourceDeletionFinalizationResult> {
  return await getApiDatabase().transaction(
    async (tx: ApiDatabaseTransaction): Promise<ResourceDeletionFinalizationResult> =>
      await finalizeProjectResourceDeletionWithExecutor(tx, resourceId),
  );
}

async function finalizeProjectResourceDeletionWithExecutor(
  tx: ApiDatabaseTransaction,
  resourceId: string,
): Promise<ResourceDeletionFinalizationResult> {
  const resource: ResourceDeletionDemandRow | null = await lockResourceDeletionDemand(tx, resourceId);
  if (resource === null) {
    return await readResourceDeletionOutcome(tx, resourceId);
  }
  const deletion: ResourceDeletionRunState | null = await readLatestResourceDeletionRunWithExecutor(tx, resourceId);
  if (!deletionDemandSatisfied(resource, deletion)) {
    return { deleteData: null, finalized: false };
  }
  await persistResourceDeletionOutcome(tx, resourceId, resource);
  await tx.delete(projectResources).where(eq(projectResources.id, resourceId));
  return { deleteData: resource.deleteDataRequested, finalized: true };
}

async function persistResourceDeletionOutcome(
  tx: ApiDatabaseTransaction,
  resourceId: string,
  resource: ResourceDeletionDemandRow,
): Promise<void> {
  await tx.insert(operations).values(buildResourceDeletionOutcomes(resourceId, resource));
}

function buildResourceDeletionOutcomes(
  resourceId: string,
  resource: ResourceDeletionDemandRow,
): ResourceDeletionOutcomeValues[] {
  const now: Date = new Date();
  const type: string = resource.deleteDataRequested ? resourceDeleteDataOperationType : resourceRetainDataOperationType;
  return [
    buildResourceDeletionOutcomeValues(
      resourceDeletionOutcomeId(resourceId),
      resource.organizationId,
      resourceId,
      resourceDeletionOutcomeTargetType,
      type,
      resourceDeletionOutcomeSummary(resource.deleteDataRequested),
      now,
    ),
    buildResourceDeletionOutcomeValues(
      resourceDeletionBindingOutcomeId(resourceId),
      resource.organizationId,
      resourceDeletionBindingTargetId(resource.environmentId, resource.name),
      resourceDeletionBindingOutcomeTargetType,
      type,
      resourceDeletionOutcomeSummary(resource.deleteDataRequested),
      now,
    ),
  ];
}

function resourceDeletionOutcomeSummary(deleteData: boolean): string {
  return deleteData ? 'Resource data deleted.' : 'Resource data retained.';
}

function buildResourceDeletionOutcomeValues(
  id: string,
  organizationId: string,
  targetId: string,
  targetType: string,
  type: string,
  summary: string,
  completedAt: Date,
): ResourceDeletionOutcomeValues {
  return { completedAt, id, organizationId, status: 'succeeded', summary, targetId, targetType, type };
}

async function readResourceDeletionOutcome(
  tx: ApiDatabaseTransaction,
  resourceId: string,
): Promise<ResourceDeletionFinalizationResult> {
  const [outcome] = await tx
    .select({ type: operations.type })
    .from(operations)
    .where(eq(operations.id, resourceDeletionOutcomeId(resourceId)))
    .limit(1);
  return buildResourceDeletionOutcome(outcome, resourceId);
}

function buildResourceDeletionOutcome(
  outcome: ResourceDeletionOutcomeRow | undefined,
  resourceId: string,
): ResourceDeletionFinalizationResult {
  if (outcome?.type === resourceDeleteDataOperationType) {
    return { deleteData: true, finalized: true };
  }
  if (outcome?.type === resourceRetainDataOperationType) {
    return { deleteData: false, finalized: true };
  }
  throw new Error(`Resource ${resourceId} disappeared without a durable deletion outcome.`);
}

function resourceDeletionOutcomeId(resourceId: string): string {
  return `op_resource_deletion_${resourceId}`;
}

function resourceDeletionBindingOutcomeId(resourceId: string): string {
  return `op_resource_deletion_binding_${resourceId}`;
}

function resourceDeletionBindingTargetId(environmentId: string, resourceName: string): string {
  return `${environmentId}${resourceDeletionBindingTargetSeparator}${resourceName}`;
}

async function lockResourceDeletionDemand(
  tx: ApiDatabaseTransaction,
  resourceId: string,
): Promise<ResourceDeletionDemandRow | null> {
  const candidate: ResourceDeletionDemandRow | null = await readResourceDeletionDemand(tx, resourceId);
  if (candidate === null) {
    return null;
  }
  await lockProjectResourceReconciliation(tx, candidate.environmentId, candidate.name);
  const [resource] = await tx
    .select({
      deleteDataRequested: projectResources.deleteDataRequested,
      environmentId: projectResources.environmentId,
      expectedClaimsJson: projectResources.expectedClaimsJson,
      name: projectResources.name,
    })
    .from(projectResources)
    .where(eq(projectResources.id, resourceId))
    .limit(1)
    .for('no key update');

  // The owning organization cannot move between environments, so the locked
  // re-read keeps the tenant resolved before the lock instead of joining under it.
  return resource === undefined ? null : { ...resource, organizationId: candidate.organizationId };
}

async function readResourceDeletionDemand(
  tx: ApiDatabaseTransaction,
  resourceId: string,
): Promise<ResourceDeletionDemandRow | null> {
  const [resource] = await tx
    .select({
      deleteDataRequested: projectResources.deleteDataRequested,
      environmentId: projectResources.environmentId,
      expectedClaimsJson: projectResources.expectedClaimsJson,
      name: projectResources.name,
      organizationId: projects.organizationId,
    })
    .from(projectResources)
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(eq(projectResources.id, resourceId))
    .limit(1);
  return resource ?? null;
}

function deletionDemandSatisfied(
  resource: ResourceDeletionDemandRow,
  deletion: ResourceDeletionRunState | null,
): boolean {
  return (
    resource.expectedClaimsJson === '[]' ||
    (deletion?.phase === 'succeeded' && (!resource.deleteDataRequested || deletion.deleteData))
  );
}

async function readLatestResourceDeletionRunWithExecutor(
  executor: ApiDatabaseTransaction | Database,
  resourceId: string,
): Promise<ResourceDeletionRunState | null> {
  const [row] = await executor
    .select({
      deleteData: sql<boolean>`(${resourceReconcileRuns.intentJson}::jsonb ->> 'deleteData')::boolean`,
      failureMessage: resourceReconcileRuns.failureMessage,
      operationId: resourceReconcileRuns.id,
      phase: resourceReconcileRuns.phase,
    })
    .from(resourceReconcileRuns)
    .where(
      and(
        eq(resourceReconcileRuns.projectResourceId, resourceId),
        eq(resourceReconcileRuns.operationType, 'reconcile'),
        sql`${resourceReconcileRuns.intentJson}::jsonb ->> 'operation' = 'delete'`,
      ),
    )
    .orderBy(desc(resourceReconcileRuns.createdAt), desc(resourceReconcileRuns.id))
    .limit(1);
  return row ?? null;
}
