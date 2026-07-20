import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { resourceReconcileRuns } from '../db/schema';

type LatestResourceReconcileColumn = 'failure_message' | 'phase';

export function latestResourceReconcileRunHasPhase(resourceId: PgColumn, phase: string): SQL {
  return sql`coalesce(${latestResourceReconcileRunValue(resourceId, 'phase')} = ${phase}, false)`;
}

export function latestResourceReconcileRunFailureMessage(resourceId: PgColumn): SQL<string | null> {
  return latestResourceReconcileRunValue<string | null>(resourceId, 'failure_message');
}

function latestResourceReconcileRunValue<T = string>(
  resourceId: PgColumn,
  column: LatestResourceReconcileColumn,
): SQL<T> {
  return sql<T>`(
    select ${sql.identifier(column)}
    from ${resourceReconcileRuns}
    where ${resourceReconcileRuns.projectResourceId} = ${resourceId}
    order by ${resourceReconcileRuns.createdAt} desc, ${resourceReconcileRuns.id} desc
    limit 1
  )`;
}
