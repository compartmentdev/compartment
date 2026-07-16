import { sql, type SQL } from 'drizzle-orm';
import { getApiDatabase } from '../runtime/runtime-access';
import type { ResourceReconcileRunWaitState } from './resource-reconcile-runs.query.types';

const reconcilePredecessorQueueSql: SQL = sql`
  select
    count(*)::int as predecessor_count,
    coalesce(
      jsonb_agg(predecessor.id order by predecessor.created_at, predecessor.id),
      '[]'::jsonb
    ) as predecessor_ids
  from resource_reconcile_runs predecessor
  where predecessor.phase in ('bootstrap-pending', 'reconcile-pending', 'running')
    and (predecessor.created_at, predecessor.id) < (current.created_at, current.id)
`;

const productJobPredecessorQueueSql: SQL = sql`
  select
    count(*)::int as predecessor_count,
    coalesce(
      jsonb_agg(predecessor.id order by predecessor.created_at, predecessor.id),
      '[]'::jsonb
    ) as predecessor_ids,
    coalesce(sum(predecessor.timeout_ms), 0)::float8 as predecessor_timeout_ms
  from product_job_runs predecessor
  where predecessor.job_class = 'resource-operation'
    and predecessor.finalized_at is null
    and exists (
      select 1
      from jsonb_array_elements_text(predecessor.resource_ids_json::jsonb) resource_ids(resource_id)
      where resource_id = current.project_resource_id
    )
    and (
      predecessor.status <> 'queued'
      or (predecessor.created_at, predecessor.id) < (current.created_at, current.id)
    )
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
      current.failure_message as "failureMessage", current.operation_type as "operationType",
      current.phase,
      reconcile_queue.predecessor_count as "predecessorCount",
      product_job_queue.predecessor_count as "predecessorProductJobCount",
      product_job_queue.predecessor_timeout_ms as "predecessorProductJobTimeoutMs",
      md5(jsonb_build_object(
        'productJobs', product_job_queue.predecessor_ids,
        'reconciles', reconcile_queue.predecessor_ids
      )::text) as "predecessorToken"
    from resource_reconcile_runs current
    cross join lateral (${reconcilePredecessorQueueSql}) reconcile_queue
    cross join lateral (${productJobPredecessorQueueSql}) product_job_queue
    where current.id = ${operationId}
    limit 1
  `;
}
