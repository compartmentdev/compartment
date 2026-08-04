import { and, eq, lte, notExists, sql, type SQL } from 'drizzle-orm';
import {
  buildArtifacts,
  deployments,
  deploymentKubeReferences,
  environments,
  projectServices,
  projects,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import { toDeploymentRow } from './deployment-row.mapper';
import type { DeploymentRow, DeploymentTransaction, PersistedDeploymentRow } from './deployments.query.types';
import type {
  BuildQueueCountsRow,
  QueuedDeploymentClaimCandidateRow,
  UpdatedDeploymentIdRow,
} from './deployment-claim.query.types';

const buildQueueAdvisoryLockId: number = 728_050_385;

const activeBuildsCommonTableExpression: SQL = sql`
  active_builds as (
    select
      ${projects.id} as project_id,
      count(*)::integer as active_build_count
    from ${deployments}
    inner join ${environments} on ${deployments.environmentId} = ${environments.id}
    inner join ${projects} on ${environments.projectId} = ${projects.id}
    where ${deployments.status} = ${'running'}
      and not exists (
        select 1
        from ${deploymentKubeReferences}
        where ${deploymentKubeReferences.deploymentId} = ${deployments.id}
      )
    group by ${projects.id}
  ),
`;

const totalActiveBuildsCommonTableExpression: SQL = sql`
  total_active_builds as (
    select coalesce(sum(active_build_count), 0)::integer as active_build_count
    from active_builds
  )
`;

const queuedBuildCandidateSelection: SQL = sql`
  select
    candidate.created_at as "createdAt",
    candidate.deployment_id as "deploymentId",
    candidate.environment_id as "environmentId",
    candidate.environment_name as "environmentName",
    candidate.organization_id as "organizationId",
    candidate.project_id as "projectId",
    candidate.project_name as "projectName",
    candidate.service_id as "serviceId",
    candidate.service_name as "serviceName"
  from (
    select
      ${deployments.id} as deployment_id,
      ${deployments.environmentId} as environment_id,
      ${environments.name} as environment_name,
      ${projects.organizationId} as organization_id,
      ${projects.id} as project_id,
      ${projects.name} as project_name,
      ${projectServices.id} as service_id,
      ${projectServices.name} as service_name,
      ${deployments.createdAt} as created_at
    from ${deployments}
    inner join ${environments} on ${deployments.environmentId} = ${environments.id}
    inner join ${projects} on ${environments.projectId} = ${projects.id}
    inner join ${projectServices} on ${deployments.projectServiceId} = ${projectServices.id}
    inner join ${buildArtifacts} on ${deployments.buildArtifactId} = ${buildArtifacts.id}
    where ${deployments.status} = ${'queued'}
      and ${projects.archivedAt} is null
      and (
        ${buildArtifacts.buildState} = ${'ready'}
        or not exists (
          select 1
          from ${deployments} artifact_owner
          where artifact_owner.build_artifact_id = ${deployments.buildArtifactId}
            and artifact_owner.status = ${'running'}
        )
      )
  ) as candidate
  left join active_builds on active_builds.project_id = candidate.project_id
  cross join total_active_builds
  inner join ${deployments} locked_deployment
    on locked_deployment.id = candidate.deployment_id
    and locked_deployment.status = ${'queued'}
`;

const fairBuildCandidateOrder: SQL = sql`
  order by
    coalesce(active_builds.active_build_count, 0),
    candidate.created_at,
    candidate.deployment_id
  for update of locked_deployment skip locked
  limit 1
`;

const buildQueueCountsQuery: SQL<BuildQueueCountsRow> = sql<BuildQueueCountsRow>`
  select
    count(*) filter (
      where ${deployments.status} = ${'running'}
        and not exists (
          select 1
          from ${deploymentKubeReferences}
          where ${deploymentKubeReferences.deploymentId} = ${deployments.id}
        )
    )::integer as "activeBuildCount",
    count(*) filter (where ${deployments.status} = ${'queued'})::integer as "queueDepth"
  from ${deployments}
`;

export async function findFirstFairQueuedDeploymentCandidateForUpdate(
  tx: DeploymentTransaction,
  maximumConcurrentBuilds: number,
  maximumConcurrentBuildsPerProject: number,
): Promise<QueuedDeploymentClaimCandidateRow | undefined> {
  await tx.execute(sql`select pg_advisory_xact_lock(${buildQueueAdvisoryLockId})`);
  const rows: object[] = (
    await tx.execute(fairQueuedDeploymentClaimQuery(maximumConcurrentBuilds, maximumConcurrentBuildsPerProject))
  ).rows;

  return rows[0] as QueuedDeploymentClaimCandidateRow | undefined;
}

function fairQueuedDeploymentClaimQuery(
  maximumConcurrentBuilds: number,
  maximumConcurrentBuildsPerProject: number,
): SQL<QueuedDeploymentClaimCandidateRow> {
  return sql<QueuedDeploymentClaimCandidateRow>`
    with
      ${activeBuildsCommonTableExpression}
      ${totalActiveBuildsCommonTableExpression}
    ${queuedBuildCandidateSelection}
    where (
      exists (
        select 1 from ${buildArtifacts} reusable_artifact
        where reusable_artifact.id = locked_deployment.build_artifact_id
          and reusable_artifact.build_state = ${'ready'}
      )
      or (
        total_active_builds.active_build_count < ${maximumConcurrentBuilds}
        and coalesce(active_builds.active_build_count, 0) < ${maximumConcurrentBuildsPerProject}
      )
    )
    ${fairBuildCandidateOrder}
  `;
}

export async function readBuildQueueCounts(tx: DeploymentTransaction): Promise<BuildQueueCountsRow> {
  const rows: object[] = (await tx.execute(buildQueueCountsQuery)).rows;
  const counts: BuildQueueCountsRow | undefined = rows[0] as BuildQueueCountsRow | undefined;
  return counts ?? { activeBuildCount: 0, queueDepth: 0 };
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

export async function claimBuildArtifactOwnershipWithExecutor(
  tx: DeploymentTransaction,
  deployment: DeploymentRow,
  now: Date,
): Promise<void> {
  await tx
    .update(buildArtifacts)
    .set({ buildOwnerDeploymentId: deployment.id, buildState: 'building', updatedAt: now })
    .where(and(eq(buildArtifacts.id, deployment.buildArtifactId), sql`${buildArtifacts.buildState} <> ${'ready'}`));
}

export async function requeueOrphanedDeploymentBuildClaims(staleBefore: Date): Promise<number> {
  const rows: UpdatedDeploymentIdRow[] = await getApiDatabase()
    .update(deployments)
    .set({ status: 'queued', updatedAt: new Date() })
    .where(
      and(
        eq(deployments.status, 'running'),
        lte(deployments.updatedAt, staleBefore),
        notExists(
          getApiDatabase()
            .select({ deploymentId: deploymentKubeReferences.deploymentId })
            .from(deploymentKubeReferences)
            .where(eq(deploymentKubeReferences.deploymentId, deployments.id)),
        ),
      ),
    )
    .returning({ id: deployments.id });
  return rows.length;
}
