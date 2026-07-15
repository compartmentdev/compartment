import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { environments, projectResources, projects, resourceReconcileRuns } from '../db/schema';
import type { ResourceReconcileProjectLockRow } from './resource-reconcile-runs.query.types';

const archivedResourceRunFailureMessage: string =
  'Resource reconciliation was canceled because the project was archived.';

export async function cancelPendingResourceReconcileRunsForProject(
  transaction: ApiDatabaseTransaction,
  projectId: string,
  canceledAt: Date,
): Promise<void> {
  await transaction
    .update(resourceReconcileRuns)
    .set({
      failureMessage: archivedResourceRunFailureMessage,
      leaseExpiresAt: null,
      leaseId: null,
      phase: 'failed',
      updatedAt: canceledAt,
    })
    .where(pendingProjectResourceRunCondition(projectId));
}

export async function lockResourceReconcileProject(
  transaction: ApiDatabaseTransaction,
  resourceId: string,
): Promise<ResourceReconcileProjectLockRow> {
  const [project] = await transaction
    .select({ archivedAt: projects.archivedAt })
    .from(projectResources)
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(eq(projectResources.id, resourceId))
    .for('update', { of: projects });
  if (project === undefined) {
    throw new Error(`Project for resource ${resourceId} was not found.`);
  }
  return project;
}

export function claimableResourceProjectCondition(): SQL | undefined {
  return or(
    isNull(projects.archivedAt),
    and(
      eq(resourceReconcileRuns.operationType, 'reconcile'),
      sql`(${resourceReconcileRuns.intentJson}::jsonb ->> 'replicas')::integer = 0`,
    ),
  );
}

function pendingProjectResourceRunCondition(projectId: string): SQL | undefined {
  return and(
    inArray(resourceReconcileRuns.phase, ['bootstrap-pending', 'reconcile-pending']),
    sql`exists (
      select 1
      from ${projectResources}
      inner join ${environments} on ${environments.id} = ${projectResources.environmentId}
      where ${projectResources.id} = ${resourceReconcileRuns.projectResourceId}
        and ${environments.projectId} = ${projectId}
    )`,
  );
}
