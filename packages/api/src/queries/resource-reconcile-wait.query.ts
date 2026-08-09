import { sql, type SQL } from 'drizzle-orm';
import { productJobRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { fencingProductJobCondition } from './resource-reconcile-job-fence.query';
import type { ResourceReconcileRunWaitState } from './resource-reconcile-runs.query.types';

const reconcilePredecessorQueueSql: SQL = sql`
  select
    count(*)::int as predecessor_count,
    coalesce(
      jsonb_agg(predecessor.id order by predecessor.created_at, predecessor.id),
      '[]'::jsonb
    ) as predecessor_ids
  -- The alias hides the base name, so the unqualified references below reach the enclosing row. Dropping it would
  -- make this compare the row to itself, count zero predecessors, and silently under-budget the wait.
  from resource_reconcile_runs predecessor
  where predecessor.phase in ('bootstrap-pending', 'reconcile-pending', 'running')
    and (predecessor.created_at, predecessor.id)
      < (resource_reconcile_runs.created_at, resource_reconcile_runs.id)
`;

// Sized from the same predicate the reconcile claim refuses on, so the wait covers exactly the Jobs that fence it.
const productJobPredecessorQueueSql: SQL = sql`
  select
    count(*)::int as predecessor_count,
    coalesce(
      jsonb_agg(${productJobRuns.id} order by ${productJobRuns.createdAt}, ${productJobRuns.id}),
      '[]'::jsonb
    ) as predecessor_ids,
    coalesce(sum(${productJobRuns.timeoutMs}), 0)::float8 as predecessor_timeout_ms
  from ${productJobRuns}
  where ${fencingProductJobCondition()}
`;

export async function readResourceReconcileRunWaitState(
  operationId: string,
): Promise<ResourceReconcileRunWaitState | null> {
  const rows: object[] = (await getApiDatabase().execute(resourceReconcileWaitStateQuery(operationId))).rows;
  return (rows[0] as ResourceReconcileRunWaitState | undefined) ?? null;
}

function resourceReconcileWaitStateQuery(operationId: string): SQL<ResourceReconcileRunWaitState> {
  return sql<ResourceReconcileRunWaitState>`
    select
      resource_reconcile_runs.failure_message as "failureMessage",
      resource_reconcile_runs.operation_type as "operationType",
      resource_reconcile_runs.phase,
      reconcile_queue.predecessor_count as "predecessorCount",
      product_job_queue.predecessor_count as "predecessorProductJobCount",
      product_job_queue.predecessor_timeout_ms as "predecessorProductJobTimeoutMs",
      md5(jsonb_build_object(
        'productJobs', product_job_queue.predecessor_ids,
        'reconciles', reconcile_queue.predecessor_ids
      )::text) as "predecessorToken"
    from resource_reconcile_runs
    cross join lateral (${reconcilePredecessorQueueSql}) reconcile_queue
    cross join lateral (${productJobPredecessorQueueSql}) product_job_queue
    where resource_reconcile_runs.id = ${operationId}
    limit 1
  `;
}
