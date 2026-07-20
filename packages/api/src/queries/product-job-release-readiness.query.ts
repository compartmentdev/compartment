import { and, eq, not, sql, type SQL } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import {
  deployments,
  environmentResourceOutputVariableBindings,
  productJobRuns,
  projectResources,
  projectServices,
  resourceReconcileRuns,
} from '../db/schema';
import { lockResourceReconcileProject } from './resource-reconcile-project.query';
import { lockResourceRuntimeClaims } from './resource-runtime-claim-lock.query';

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
): Promise<boolean> {
  const rows: { id: string }[] = await transaction
    .select({ id: projectResources.id })
    .from(deployments)
    .innerJoin(projectServices, eq(projectServices.id, deployments.projectServiceId))
    .innerJoin(environmentResourceOutputVariableBindings, releaseResourceBindingCondition())
    .innerJoin(projectResources, releaseProjectResourceCondition())
    .where(eq(deployments.id, deploymentId));
  rows.sort((left: { id: string }, right: { id: string }): number => left.id.localeCompare(right.id));
  for (const row of rows) {
    await lockResourceReconcileProject(transaction, row.id);
  }
  await lockResourceRuntimeClaims(
    transaction,
    rows.map((row: { id: string }): string => row.id),
  );
  return !(await hasBlockingReleaseResource(transaction, deploymentId));
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

function releaseResourceBindingCondition(): SQL {
  return sql`${environmentResourceOutputVariableBindings.environmentId} = ${deployments.environmentId}
    and ${environmentResourceOutputVariableBindings.targetServiceName} = ${projectServices.name}
    and ${environmentResourceOutputVariableBindings.source} = 'descriptor'`;
}

function releaseProjectResourceCondition(): SQL {
  return sql`${projectResources.environmentId} = ${deployments.environmentId}
    and ${projectResources.name} = ${environmentResourceOutputVariableBindings.resourceName}`;
}

function blockingReleaseResourceCondition(): SQL {
  return sql`(
    ${projectResources.id} is null
    or ${projectResources.status} <> 'running'
    or not exists (
      select 1
      from ${resourceReconcileRuns}
      where ${resourceReconcileRuns.projectResourceId} = ${projectResources.id}
        and ${resourceReconcileRuns.phase} = 'succeeded'
        and not exists (${newerResourceReconcileRun()})
    )
  )`;
}

function newerResourceReconcileRun(): SQL {
  return sql`select 1
    from ${resourceReconcileRuns} newer_reconcile
    where newer_reconcile.project_resource_id = ${projectResources.id}
      and (newer_reconcile.created_at, newer_reconcile.id)
        > (${resourceReconcileRuns.createdAt}, ${resourceReconcileRuns.id})`;
}
