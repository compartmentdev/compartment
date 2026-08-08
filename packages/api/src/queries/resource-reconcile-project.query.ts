import { and, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { environments, projectResources, projects, resourceReconcileRuns } from '../db/schema';
import type { ResourceReconcileProjectLockRow } from './resource-reconcile-runs.query.types';

export const archivedResourceRunFailureMessage: string =
  'Resource reconciliation was canceled because the project was archived.';

export async function cancelResourceReconcileRunsForProjectArchive(
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
    .where(archivedProjectResourceRunCondition(projectId));
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
    .for('no key update', { of: projects });
  if (project === undefined) {
    throw new Error(`Project for resource ${resourceId} was not found.`);
  }
  const [resource] = await transaction
    .select({ resourceStatus: projectResources.status })
    .from(projectResources)
    .where(eq(projectResources.id, resourceId))
    .for('no key update');
  if (resource === undefined) {
    throw new Error(`Resource ${resourceId} was not found.`);
  }
  return { ...project, ...resource };
}

export function claimableResourceProjectCondition(): SQL | undefined {
  // Postgres `now()` keeps this lease check on the clock the rest of the claim decision uses.
  return or(
    isNull(projects.archivedAt),
    and(
      eq(resourceReconcileRuns.operationType, 'bootstrap'),
      eq(resourceReconcileRuns.phase, 'running'),
      or(isNull(resourceReconcileRuns.leaseExpiresAt), lt(resourceReconcileRuns.leaseExpiresAt, sql`now()`)),
    ),
    and(
      eq(resourceReconcileRuns.operationType, 'reconcile'),
      sql`(${resourceReconcileRuns.intentJson}::jsonb ->> 'replicas')::integer = 0`,
    ),
  );
}

function archivedProjectResourceRunCondition(projectId: string): SQL | undefined {
  return and(
    or(
      and(eq(resourceReconcileRuns.operationType, 'bootstrap'), eq(resourceReconcileRuns.phase, 'bootstrap-pending')),
      and(
        eq(resourceReconcileRuns.operationType, 'reconcile'),
        inArray(resourceReconcileRuns.phase, ['reconcile-pending', 'running']),
        sql`(${resourceReconcileRuns.intentJson}::jsonb ->> 'replicas')::integer <> 0`,
      ),
    ),
    sql`exists (
      select 1
      from ${projectResources}
      inner join ${environments} on ${environments.id} = ${projectResources.environmentId}
      where ${projectResources.id} = ${resourceReconcileRuns.projectResourceId}
        and ${environments.projectId} = ${projectId}
    )`,
  );
}
