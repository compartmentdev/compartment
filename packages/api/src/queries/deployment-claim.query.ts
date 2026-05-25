import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  deployments,
  deploymentMovementOrganizationState,
  environments,
  projectServices,
  projects,
} from '../db/schema';
import { requirePersistedRow } from './persisted-row.query.shared';
import { toDeploymentRow } from './deployment-row.mapper';
import type { DeploymentRow, DeploymentTransaction, PersistedDeploymentRow } from './deployments.query.types';
import type { QueuedDeploymentClaimCandidateRow } from './deployment-claim.query.types';

// Persist the last claim turn per organization so fairness survives serial single-worker claims.
const fairQueuedDeploymentClaimQuery: SQL<QueuedDeploymentClaimCandidateRow> = sql<QueuedDeploymentClaimCandidateRow>`
  select
    candidate.deployment_id as "deploymentId",
    candidate.environment_id as "environmentId",
    candidate.environment_name as "environmentName",
    candidate.organization_id as "organizationId",
    candidate.project_name as "projectName",
    candidate.service_id as "serviceId",
    candidate.service_name as "serviceName"
  from (
    select
      ${deployments.id} as deployment_id,
      ${deployments.environmentId} as environment_id,
      ${environments.name} as environment_name,
      ${projects.organizationId} as organization_id,
      ${projects.name} as project_name,
      ${projectServices.id} as service_id,
      ${projectServices.name} as service_name,
      ${deployments.createdAt} as created_at,
      ${deploymentMovementOrganizationState.lastClaimedAt} as last_claimed_at,
      row_number() over (
        partition by ${projects.organizationId}
        order by ${deployments.createdAt}, ${deployments.id}
      ) as organization_queue_rank
    from ${deployments}
    inner join ${environments} on ${deployments.environmentId} = ${environments.id}
    inner join ${projects} on ${environments.projectId} = ${projects.id}
    inner join ${projectServices} on ${deployments.projectServiceId} = ${projectServices.id}
    left join ${deploymentMovementOrganizationState}
      on ${deploymentMovementOrganizationState.organizationId} = ${projects.organizationId}
    where ${deployments.status} = ${'queued'}
      and ${projects.archivedAt} is null
  ) as candidate
  inner join ${deployments} locked_deployment
    on locked_deployment.id = candidate.deployment_id
    and locked_deployment.status = ${'queued'}
  order by
    candidate.organization_queue_rank,
    candidate.last_claimed_at nulls first,
    candidate.created_at,
    candidate.deployment_id
  for update of locked_deployment skip locked
  limit 1
`;

export async function findFirstFairQueuedDeploymentCandidateForUpdate(
  tx: DeploymentTransaction,
): Promise<QueuedDeploymentClaimCandidateRow | undefined> {
  const rows: object[] = (await tx.execute(fairQueuedDeploymentClaimQuery)).rows;

  return rows[0] as QueuedDeploymentClaimCandidateRow | undefined;
}

export async function recordDeploymentMovementOrganizationClaim(
  tx: DeploymentTransaction,
  organizationId: string,
  claimedAt: Date,
): Promise<void> {
  await tx
    .insert(deploymentMovementOrganizationState)
    .values({
      lastClaimedAt: claimedAt,
      organizationId,
    })
    .onConflictDoUpdate({
      set: {
        lastClaimedAt: claimedAt,
      },
      target: deploymentMovementOrganizationState.organizationId,
    });
}

export async function markQueuedDeploymentRunningWithExecutor(
  tx: DeploymentTransaction,
  deploymentId: string,
  now: Date,
): Promise<DeploymentRow | undefined> {
  const rows: PersistedDeploymentRow[] = await tx
    .update(deployments)
    .set({
      status: 'running',
      updatedAt: now,
    })
    .where(and(eq(deployments.id, deploymentId), eq(deployments.status, 'queued')))
    .returning();

  return rows[0] === undefined ? undefined : toDeploymentRow(requirePersistedRow(rows[0], 'deployment'));
}
