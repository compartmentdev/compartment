import { and, eq, not, sql, type SQL } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import {
  deployments,
  environmentResourceOutputVariableBindings,
  operations,
  productJobRuns,
  projectResources,
  projectServices,
  resourceReconcileRuns,
} from '../db/schema';
import { lockResourceReconcileProject } from './resource-reconcile-project.query';
import {
  resourceDeletionBindingOutcomeTargetType,
  resourceDeletionBindingTargetSeparator,
} from './resource-reconcile-deletion.query';
import { releaseProjectResourceCondition, releaseResourceBindingCondition } from './product-job-release-bindings.query';
import { lockResourceRuntimeClaims } from './resource-runtime-claim-lock.query';
import { lockProjectResourceIdentity } from './resources.query';
import type {
  ReleaseResourceBindingRow,
  ReleaseResourceIdRow,
  TerminalReleaseResourceRow,
  TerminalReleaseResourceStatus,
} from './product-job-release-readiness.query.types';
import type { ProductJobResourceFenceResult } from './product-job-runs.query.types';

export async function expireBlockedReleaseJobs(transaction: ApiDatabaseTransaction, expiredAt: Date): Promise<void> {
  await transaction
    .update(productJobRuns)
    .set({
      completedAt: expiredAt,
      exitCode: null,
      jobName: sql`'queue-timeout/' || ${productJobRuns.identityId}`,
      logs: 'Release Job timed out waiting for a declared resource to become ready.',
      podName: null,
      status: 'timed-out',
      updatedAt: expiredAt,
    })
    .where(
      and(
        eq(productJobRuns.jobClass, 'release'),
        eq(productJobRuns.status, 'queued'),
        sql`${productJobRuns.createdAt} + (${productJobRuns.timeoutMs} * interval '1 millisecond') <= ${expiredAt}`,
        not(releaseResourceReadinessFence()),
      ),
    );
}

export async function lockReleaseJobResourceFence(
  transaction: ApiDatabaseTransaction,
  deploymentId: string,
): Promise<ProductJobResourceFenceResult> {
  await lockReleaseResources(transaction, deploymentId);
  const terminalResource: TerminalReleaseResourceRow | undefined = await findTerminalReleaseResource(
    transaction,
    deploymentId,
  );
  if (terminalResource !== undefined) {
    await failTerminalReleaseJob(transaction, deploymentId, terminalResource, new Date());
    return 'terminalized';
  }
  return (await hasBlockingReleaseResource(transaction, deploymentId)) ? 'blocked' : 'claimable';
}

async function lockReleaseResources(transaction: ApiDatabaseTransaction, deploymentId: string): Promise<void> {
  await lockReleaseResourceBindings(transaction, deploymentId);
  const rows: ReleaseResourceIdRow[] = await readReleaseResourceIds(transaction, deploymentId);
  for (const row of rows) {
    await lockResourceReconcileProject(transaction, row.id);
  }
  await lockResourceRuntimeClaims(
    transaction,
    rows.map((row: ReleaseResourceIdRow): string => row.id),
  );
}

async function lockReleaseResourceBindings(transaction: ApiDatabaseTransaction, deploymentId: string): Promise<void> {
  const bindings: ReleaseResourceBindingRow[] = await transaction
    .select({
      environmentId: environmentResourceOutputVariableBindings.environmentId,
      resourceName: environmentResourceOutputVariableBindings.resourceName,
    })
    .from(deployments)
    .innerJoin(projectServices, eq(projectServices.id, deployments.projectServiceId))
    .innerJoin(environmentResourceOutputVariableBindings, releaseResourceBindingCondition())
    .where(eq(deployments.id, deploymentId));
  bindings.sort((left: ReleaseResourceBindingRow, right: ReleaseResourceBindingRow): number =>
    releaseResourceBindingLockKey(left).localeCompare(releaseResourceBindingLockKey(right)),
  );
  for (const binding of bindings) {
    await lockProjectResourceIdentity(transaction, binding.environmentId, binding.resourceName);
  }
}

function releaseResourceBindingLockKey(binding: ReleaseResourceBindingRow): string {
  return `${binding.environmentId}:${binding.resourceName}`;
}

/** Descriptor-bound resources of a release, in the canonical lock order. */
export async function readReleaseResourceIds(
  transaction: ApiDatabaseTransaction,
  deploymentId: string,
): Promise<ReleaseResourceIdRow[]> {
  const rows: ReleaseResourceIdRow[] = await transaction
    .select({ id: projectResources.id })
    .from(deployments)
    .innerJoin(projectServices, eq(projectServices.id, deployments.projectServiceId))
    .innerJoin(environmentResourceOutputVariableBindings, releaseResourceBindingCondition())
    .innerJoin(projectResources, releaseProjectResourceCondition())
    .where(eq(deployments.id, deploymentId));
  rows.sort((left: ReleaseResourceIdRow, right: ReleaseResourceIdRow): number => left.id.localeCompare(right.id));
  return rows;
}

async function findTerminalReleaseResource(
  transaction: ApiDatabaseTransaction,
  deploymentId: string,
): Promise<TerminalReleaseResourceRow | undefined> {
  const [terminal] = await transaction
    .select({
      failureMessage: sql<string | null>`(
        select latest_reconcile.failure_message
        from ${resourceReconcileRuns} latest_reconcile
        where latest_reconcile.project_resource_id = ${projectResources.id}
        order by latest_reconcile.created_at desc, latest_reconcile.id desc
        limit 1
      )`,
      name: environmentResourceOutputVariableBindings.resourceName,
      status: sql<TerminalReleaseResourceStatus>`coalesce(${projectResources.status}, 'deleted')`,
    })
    .from(deployments)
    .innerJoin(projectServices, eq(projectServices.id, deployments.projectServiceId))
    .innerJoin(environmentResourceOutputVariableBindings, releaseResourceBindingCondition())
    .leftJoin(projectResources, releaseProjectResourceCondition())
    .where(and(eq(deployments.id, deploymentId), terminalReleaseResourceCondition()))
    .limit(1);
  return terminal;
}

async function failTerminalReleaseJob(
  transaction: ApiDatabaseTransaction,
  deploymentId: string,
  resource: TerminalReleaseResourceRow,
  failedAt: Date,
): Promise<void> {
  await transaction
    .update(productJobRuns)
    .set({
      completedAt: failedAt,
      exitCode: null,
      jobName: sql`'resource-readiness/' || ${productJobRuns.identityId}`,
      logs: terminalReleaseFailureLog(resource),
      podName: null,
      status: 'failed',
      updatedAt: failedAt,
    })
    .where(queuedReleaseJobCondition(deploymentId));
}

function terminalReleaseFailureLog(resource: TerminalReleaseResourceRow): string {
  if (resource.status === 'deleting' || resource.status === 'deleted') {
    return `Release Job failed before execution. Declared resource ${resource.name} was deleted.`;
  }
  const detail: string = resource.failureMessage === null ? '.' : `: ${resource.failureMessage}`;
  return `Release Job failed before execution. Declared resource ${resource.name} reconciliation failed${detail}`;
}

function queuedReleaseJobCondition(deploymentId: string): SQL | undefined {
  return and(
    eq(productJobRuns.jobClass, 'release'),
    eq(productJobRuns.identityId, deploymentId),
    eq(productJobRuns.status, 'queued'),
  );
}

async function hasBlockingReleaseResource(transaction: ApiDatabaseTransaction, deploymentId: string): Promise<boolean> {
  const [blocking] = await transaction
    .select({ id: deployments.id })
    .from(deployments)
    .innerJoin(projectServices, eq(projectServices.id, deployments.projectServiceId))
    .innerJoin(environmentResourceOutputVariableBindings, releaseResourceBindingCondition())
    .leftJoin(projectResources, releaseProjectResourceCondition())
    .where(and(eq(deployments.id, deploymentId), blockingReleaseResourceCondition()))
    .limit(1);
  return blocking !== undefined;
}

export function releaseResourceReadinessFence(): SQL {
  return sql`not exists (
    select 1
    from ${deployments}
    inner join ${projectServices}
      on ${projectServices.id} = ${deployments.projectServiceId}
    inner join ${environmentResourceOutputVariableBindings}
      on ${releaseResourceBindingCondition()}
    left join ${projectResources}
      on ${releaseProjectResourceCondition()}
    where ${deployments.id} = ${productJobRuns.identityId}
      and ${blockingReleaseResourceCondition()}
  )`;
}

function blockingReleaseResourceCondition(): SQL {
  return sql`(
    not (${terminalReleaseResourceCondition()})
    and (
      ${projectResources.id} is null
      or ${projectResources.status} <> 'running'
      or not (${latestResourceReconcilePhaseCondition('succeeded')})
    )
  )`;
}

function terminalReleaseResourceCondition(): SQL {
  return sql`(
    coalesce(${projectResources.status} = 'deleting', false)
    or ${latestResourceReconcilePhaseCondition('failed')}
    or (
      ${projectResources.id} is null
      and exists (
        select 1
        from ${operations}
        where ${operations.targetType} = ${resourceDeletionBindingOutcomeTargetType}
          and ${operations.targetId} = (
            ${environmentResourceOutputVariableBindings.environmentId}
              || ${resourceDeletionBindingTargetSeparator}
              || ${environmentResourceOutputVariableBindings.resourceName}
          )
          and ${operations.completedAt} >= (
            select release_job.created_at
            from ${productJobRuns} release_job
            where release_job.job_class = 'release'
              and release_job.identity_id = ${deployments.id}
          )
      )
    )
  )`;
}

function latestResourceReconcilePhaseCondition(phase: 'failed' | 'succeeded'): SQL {
  return sql`exists (
    select 1
    from ${resourceReconcileRuns}
    where ${resourceReconcileRuns.projectResourceId} = ${projectResources.id}
      and ${resourceReconcileRuns.phase} = ${phase}
      and not exists (${newerResourceReconcileRun()})
  )`;
}

function newerResourceReconcileRun(): SQL {
  return sql`select 1
    from ${resourceReconcileRuns} newer_reconcile
    where newer_reconcile.project_resource_id = ${projectResources.id}
      and (newer_reconcile.created_at, newer_reconcile.id)
        > (${resourceReconcileRuns.createdAt}, ${resourceReconcileRuns.id})`;
}
