import { and, asc, eq, exists, inArray, ne, not, notExists, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { BuildAliasTable } from 'drizzle-orm/pg-core/query-builders/select.types';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { deployments, environments, productJobRuns, projectResources } from '../db/schema';
import { latestResourceReconcileRunHasPhase } from './latest-resource-reconcile-run.query';

const releaseDeployments: BuildAliasTable<typeof deployments, 'release_deployments'> = alias(
  deployments,
  'release_deployments',
);
const releaseEnvironments: BuildAliasTable<typeof environments, 'release_environments'> = alias(
  environments,
  'release_environments',
);
const releaseResources: BuildAliasTable<typeof projectResources, 'release_resources'> = alias(
  projectResources,
  'release_resources',
);

export async function cancelInvalidReleaseProductJob(
  transaction: ApiDatabaseTransaction,
  canceledAt: Date,
  deploymentId?: string,
): Promise<void> {
  await transaction
    .update(productJobRuns)
    .set(invalidReleaseValues(canceledAt))
    .where(
      and(
        eq(productJobRuns.jobClass, 'release'),
        deploymentId === undefined ? undefined : eq(productJobRuns.identityId, deploymentId),
        eq(productJobRuns.status, 'queued'),
        not(releaseDeploymentEligible(transaction)),
      ),
    );
}

export async function lockReleaseProductJobResources(
  transaction: ApiDatabaseTransaction,
  deploymentId: string,
): Promise<void> {
  const resourceIds: string[] = await findReleaseResourceIds(transaction, deploymentId);
  if (resourceIds.length === 0) {
    return;
  }
  await transaction
    .select({ id: projectResources.id })
    .from(projectResources)
    .where(inArray(projectResources.id, resourceIds))
    .orderBy(asc(projectResources.id))
    .for('share');
}

export function releaseProductJobReady(transaction: ApiDatabaseTransaction): SQL {
  return and(releaseDeploymentEligible(transaction), releaseResourcesReady(transaction))!;
}

function invalidReleaseValues(canceledAt: Date): Partial<typeof productJobRuns.$inferInsert> {
  return {
    completedAt: canceledAt,
    exitCode: null,
    jobName: 'prerequisite-failed-job',
    logs: 'Release Job canceled because its deployment prerequisites are no longer valid.',
    podName: null,
    status: 'failed',
    updatedAt: canceledAt,
  };
}

function releaseDeploymentEligible(transaction: ApiDatabaseTransaction): SQL {
  return exists(
    transaction
      .select({ id: releaseDeployments.id })
      .from(releaseDeployments)
      .innerJoin(releaseEnvironments, eq(releaseEnvironments.id, releaseDeployments.environmentId))
      .where(
        and(
          eq(releaseDeployments.id, productJobRuns.identityId),
          eq(releaseEnvironments.projectId, productJobRuns.projectId),
          inArray(releaseDeployments.status, ['running', 'succeeded']),
        ),
      ),
  );
}

async function findReleaseResourceIds(transaction: ApiDatabaseTransaction, deploymentId: string): Promise<string[]> {
  const rows: { id: string }[] = await transaction
    .select({ id: releaseResources.id })
    .from(releaseDeployments)
    .innerJoin(releaseResources, eq(releaseResources.environmentId, releaseDeployments.environmentId))
    .where(eq(releaseDeployments.id, deploymentId))
    .orderBy(asc(releaseResources.id));
  return rows.map((row: { id: string }): string => row.id);
}

function releaseResourcesReady(transaction: ApiDatabaseTransaction): SQL {
  return notExists(
    transaction
      .select({ id: releaseResources.id })
      .from(releaseDeployments)
      .innerJoin(releaseResources, eq(releaseResources.environmentId, releaseDeployments.environmentId))
      .where(and(eq(releaseDeployments.id, productJobRuns.identityId), releaseResourceUnready())),
  );
}

function releaseResourceUnready(): SQL {
  return or(ne(releaseResources.status, 'running'), not(latestReleaseResourceRunSucceeded()))!;
}

function latestReleaseResourceRunSucceeded(): SQL {
  return latestResourceReconcileRunHasPhase(releaseResources.id, 'succeeded');
}
