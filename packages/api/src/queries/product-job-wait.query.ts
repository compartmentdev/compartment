import type { ProductJobClass, WorkerPersistProductJobResultRequest } from '@compartment/contracts';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { productJobRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { readProductJobResult } from './product-job-runs.query';
import type { PersistProductJobResultInput } from './product-job-runs.query.types';
import type { ProductJobQueueWaitRow, ProductJobQueueWaitState } from './product-job-wait.query.types';
import { resourceReconcileOperationWaitTimeoutMs } from './resource-reconcile-policy';

const productJobPredecessorQueueSql: SQL = sql`
  select
    coalesce(
      jsonb_agg(predecessor.id order by predecessor.created_at, predecessor.id),
      '[]'::jsonb
    ) as predecessor_ids,
    coalesce(sum(predecessor.timeout_ms), 0) as predecessor_timeout_ms
  from product_job_runs predecessor
  where predecessor.job_class = current.job_class
    and (predecessor.created_at, predecessor.id) < (current.created_at, current.id)
    and (
      predecessor.status in ('queued', 'running')
      or (predecessor.status in ('succeeded', 'failed', 'timed-out') and predecessor.finalized_at is null)
    )
`;

const resourcePredecessorConditionSql: SQL = sql`
  exists (
    select 1
    from jsonb_array_elements_text(current.resource_ids_json::jsonb) resource_ids(resource_id)
    where resource_id = predecessor.project_resource_id
  )
  and (
    predecessor.phase = 'running'
    or (
      predecessor.phase in ('bootstrap-pending', 'reconcile-pending')
      and (predecessor.created_at, predecessor.id) < (current.created_at, current.id)
    )
  )
`;

const resourcePredecessorQueueSql: SQL = sql`
  select
    (count(*) filter (where predecessor.operation_type = 'bootstrap'))::int as bootstrap_count,
    coalesce(
      jsonb_agg(predecessor.id order by predecessor.created_at, predecessor.id),
      '[]'::jsonb
    ) as predecessor_ids,
    (count(*) filter (where predecessor.operation_type = 'reconcile'))::int as reconcile_count
  from resource_reconcile_runs predecessor
  where current.job_class = 'resource-operation'
    and ${resourcePredecessorConditionSql}
`;

export async function readProductJobQueueWaitState(
  jobClass: ProductJobClass,
  identityId: string,
): Promise<ProductJobQueueWaitState | null> {
  const rows: object[] = (await getApiDatabase().execute(productJobQueueWaitStateQuery(jobClass, identityId))).rows;
  const row: ProductJobQueueWaitRow | undefined = rows[0] as ProductJobQueueWaitRow | undefined;
  return row === undefined ? null : parseProductJobQueueWaitState(row, jobClass, identityId);
}

export async function expireProductJobWait(
  input: PersistProductJobResultInput,
): Promise<WorkerPersistProductJobResultRequest> {
  await getApiDatabase()
    .update(productJobRuns)
    .set(productJobWaitExpirationValues(input))
    .where(
      and(
        eq(productJobRuns.jobClass, input.jobClass),
        eq(productJobRuns.identityId, input.identityId),
        inArray(productJobRuns.status, ['queued', 'running']),
      ),
    );
  return await requireExpiredProductJob(input);
}

function productJobQueueWaitStateQuery(jobClass: ProductJobClass, identityId: string): SQL<ProductJobQueueWaitRow> {
  return sql<ProductJobQueueWaitRow>`
    select
      md5(jsonb_build_object(
        'productJobs', product_job_queue.predecessor_ids,
        'reconciles', resource_queue.predecessor_ids
      )::text) as "predecessorToken",
      current.timeout_ms + product_job_queue.predecessor_timeout_ms as "productJobBudgetMs",
      resource_queue.bootstrap_count as "resourceBootstrapPredecessorCount",
      resource_queue.reconcile_count as "resourceReconcilePredecessorCount"
    from product_job_runs current
    cross join lateral (${productJobPredecessorQueueSql}) product_job_queue
    cross join lateral (${resourcePredecessorQueueSql}) resource_queue
    where current.job_class = ${jobClass} and current.identity_id = ${identityId}
  `;
}

function parseProductJobQueueWaitState(
  row: ProductJobQueueWaitRow,
  jobClass: ProductJobClass,
  identityId: string,
): ProductJobQueueWaitState {
  const productJobBudgetMs: number = Number(row.productJobBudgetMs);
  const queueBudgetMs: number =
    productJobBudgetMs +
    row.resourceBootstrapPredecessorCount * resourceReconcileOperationWaitTimeoutMs('bootstrap') +
    row.resourceReconcilePredecessorCount * resourceReconcileOperationWaitTimeoutMs('reconcile');
  if (!Number.isSafeInteger(queueBudgetMs) || queueBudgetMs < 1) {
    throw new Error(`Product Job ${jobClass}/${identityId} has an invalid queue budget.`);
  }
  return { predecessorToken: row.predecessorToken, queueBudgetMs };
}

function productJobWaitExpirationValues(
  input: PersistProductJobResultInput,
): Partial<typeof productJobRuns.$inferInsert> {
  return {
    completedAt: new Date(input.completedAt),
    exitCode: input.exitCode,
    jobName: input.jobName,
    logs: input.logs,
    podName: input.podName,
    status: input.status,
    updatedAt: new Date(),
  };
}

async function requireExpiredProductJob(
  input: PersistProductJobResultInput,
): Promise<WorkerPersistProductJobResultRequest> {
  const result: WorkerPersistProductJobResultRequest | null = await readProductJobResult(
    input.jobClass,
    input.identityId,
  );
  if (result === null) {
    throw new Error(`Product Job ${input.jobClass}/${input.identityId} disappeared while expiring its queue wait.`);
  }
  return result;
}
