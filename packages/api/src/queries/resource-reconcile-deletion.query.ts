import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { environments, operations, projectResources, projects, resourceReconcileRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  ResourceDeletionFinalizationResult,
  ResourceDeletionOutcomeRow,
} from './resource-reconcile-deletion.query.types';
import type { ResourceDeletionDemandRow, ResourceDeletionRunState } from './resource-reconcile-runs.query.types';

const resourceDeletionOutcomeTargetType: string = 'resource-deletion-outcome';
const resourceDeleteDataOperationType: string = 'resource.delete-data';
const resourceRetainDataOperationType: string = 'resource.delete-retain-data';

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
  await persistResourceDeletionOutcome(tx, resourceId, resource.deleteDataRequested);
  await tx.delete(projectResources).where(eq(projectResources.id, resourceId));
  return { deleteData: resource.deleteDataRequested, finalized: true };
}

async function persistResourceDeletionOutcome(
  tx: ApiDatabaseTransaction,
  resourceId: string,
  deleteData: boolean,
): Promise<void> {
  const now: Date = new Date();
  await tx.insert(operations).values({
    completedAt: now,
    id: resourceDeletionOutcomeId(resourceId),
    status: 'succeeded',
    summary: deleteData ? 'Resource data deleted.' : 'Resource data retained.',
    targetId: resourceId,
    targetType: resourceDeletionOutcomeTargetType,
    type: deleteData ? resourceDeleteDataOperationType : resourceRetainDataOperationType,
  });
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

async function lockResourceDeletionDemand(
  tx: ApiDatabaseTransaction,
  resourceId: string,
): Promise<ResourceDeletionDemandRow | null> {
  const projectId: string | null = await readResourceProjectId(tx, resourceId);
  if (projectId === null) {
    return null;
  }
  await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for('no key update');
  const [resource] = await tx
    .select({
      deleteDataRequested: projectResources.deleteDataRequested,
      expectedClaimsJson: projectResources.expectedClaimsJson,
    })
    .from(projectResources)
    .where(eq(projectResources.id, resourceId))
    .limit(1)
    .for('no key update');
  return resource ?? null;
}

async function readResourceProjectId(tx: ApiDatabaseTransaction, resourceId: string): Promise<string | null> {
  const [candidate] = await tx
    .select({ projectId: environments.projectId })
    .from(projectResources)
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .where(eq(projectResources.id, resourceId))
    .limit(1);
  return candidate?.projectId ?? null;
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
