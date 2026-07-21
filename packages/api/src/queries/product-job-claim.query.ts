import type { ProductJobClass } from '@compartment/contracts';
import { and, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { productJobRuns, projects, resourceReconcileRuns } from '../db/schema';
import type { ProductJobResourceFenceResult, ProductJobRunRow } from './product-job-runs.query.types';
import { lockResourceRuntimeClaims } from './resource-runtime-claim-lock.query';
import {
  expireBlockedReleaseJobs,
  lockReleaseJobResourceFence,
  releaseResourceReadinessFence,
} from './product-job-release-readiness.query';

export async function prepareProductJobClaim(
  transaction: ApiDatabaseTransaction,
  jobClass: ProductJobClass,
): Promise<SQL | undefined> {
  await cancelArchivedProductJobs(transaction, jobClass, new Date());
  if (jobClass === 'release') {
    await expireBlockedReleaseJobs(transaction, new Date());
  }
  return claimableProductJobCondition(jobClass);
}

export async function lockProductJobResourceFence(
  transaction: ApiDatabaseTransaction,
  row: ProductJobRunRow,
): Promise<ProductJobResourceFenceResult> {
  if (row.status !== 'queued') {
    return 'claimable';
  }
  if (row.jobClass === 'release') {
    return await lockReleaseJobResourceFence(transaction, row.identityId);
  }
  const resourceIds: string[] = JSON.parse(row.resourceIdsJson) as string[];
  await lockResourceRuntimeClaims(transaction, resourceIds);
  return !(await hasBlockingResourceReconcile(transaction, row, resourceIds)) &&
    !(await hasActiveResourceJob(transaction, row.identityId, resourceIds))
    ? 'claimable'
    : 'blocked';
}

async function hasBlockingResourceReconcile(
  transaction: ApiDatabaseTransaction,
  row: ProductJobRunRow,
  resourceIds: string[],
): Promise<boolean> {
  const [active] = await transaction
    .select({ id: resourceReconcileRuns.id })
    .from(resourceReconcileRuns)
    .where(
      and(
        inArray(resourceReconcileRuns.projectResourceId, resourceIds),
        or(
          eq(resourceReconcileRuns.phase, 'running'),
          and(
            inArray(resourceReconcileRuns.phase, ['bootstrap-pending', 'reconcile-pending']),
            sql`(${resourceReconcileRuns.createdAt}, ${resourceReconcileRuns.id}) < (${row.createdAt}, ${row.id})`,
          ),
        ),
      ),
    )
    .limit(1);
  return active !== undefined;
}

async function hasActiveResourceJob(
  transaction: ApiDatabaseTransaction,
  identityId: string,
  resourceIds: string[],
): Promise<boolean> {
  const [activeJob] = await transaction
    .select({ id: productJobRuns.id })
    .from(productJobRuns)
    .where(
      and(
        eq(productJobRuns.jobClass, 'resource-operation'),
        eq(productJobRuns.status, 'running'),
        ne(productJobRuns.identityId, identityId),
        sql`exists (
          select 1
          from jsonb_array_elements_text(${productJobRuns.resourceIdsJson}::jsonb) resource_ids(resource_id)
          where resource_id in (${resourceIdSqlList(resourceIds)})
        )`,
      ),
    )
    .limit(1);
  return activeJob !== undefined;
}

function resourceIdSqlList(resourceIds: string[]): SQL {
  return sql.join(
    resourceIds.map((resourceId: string): SQL => sql`${resourceId}`),
    sql`, `,
  );
}

export async function cancelProjectProductJobsForArchive(
  transaction: ApiDatabaseTransaction,
  projectId: string,
  canceledAt: Date,
): Promise<void> {
  await cancelProductJobs(transaction, eq(productJobRuns.projectId, projectId), undefined, canceledAt);
}

async function cancelArchivedProductJobs(
  transaction: ApiDatabaseTransaction,
  jobClass: ProductJobClass,
  canceledAt: Date,
): Promise<void> {
  await cancelProductJobs(transaction, archivedProductJobProjectCondition(), jobClass, canceledAt);
}

async function cancelProductJobs(
  transaction: ApiDatabaseTransaction,
  projectCondition: SQL,
  jobClass: ProductJobClass | undefined,
  canceledAt: Date,
): Promise<void> {
  await transaction
    .update(productJobRuns)
    .set({
      completedAt: canceledAt,
      exitCode: null,
      jobName: sql`'archived-job/' || ${productJobRuns.identityId}`,
      logs: 'Product Job canceled because its project was archived.',
      podName: null,
      status: 'timed-out',
      updatedAt: canceledAt,
    })
    .where(
      and(
        jobClass === undefined ? undefined : eq(productJobRuns.jobClass, jobClass),
        inArray(productJobRuns.status, ['queued', 'running']),
        projectCondition,
      ),
    );
}

function archivedProductJobProjectCondition(): SQL {
  return sql`exists (
    select 1
    from ${projects}
    where ${projects.id} = ${productJobRuns.projectId}
      and ${projects.archivedAt} is not null
  )`;
}

function claimableProductJobCondition(jobClass: ProductJobClass): SQL | undefined {
  const terminal: SQL | undefined = and(
    inArray(productJobRuns.status, ['succeeded', 'failed', 'timed-out']),
    isNull(productJobRuns.finalizedAt),
  );
  if (jobClass === 'resource-operation') {
    return or(
      and(eq(productJobRuns.status, 'queued'), resourceOperationReconcileFence()),
      eq(productJobRuns.status, 'running'),
      terminal,
    );
  }
  return or(
    and(eq(productJobRuns.status, 'queued'), releaseResourceReadinessFence()),
    eq(productJobRuns.status, 'running'),
    terminal,
  );
}

function resourceOperationReconcileFence(): SQL {
  return sql`not exists (
    select 1
    from jsonb_array_elements_text(${productJobRuns.resourceIdsJson}::jsonb) as resource_ids(resource_id)
    inner join ${resourceReconcileRuns}
      on ${resourceReconcileRuns.projectResourceId} = resource_id
    where (
      ${resourceReconcileRuns.phase} = 'running'
      or (
        ${resourceReconcileRuns.phase} in ('bootstrap-pending', 'reconcile-pending')
        and (${resourceReconcileRuns.createdAt}, ${resourceReconcileRuns.id})
          < (${productJobRuns.createdAt}, ${productJobRuns.id})
      )
    )
  )`;
}
