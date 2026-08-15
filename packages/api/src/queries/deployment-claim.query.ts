import { and, eq, inArray, lte, notExists, sql, type SQL } from 'drizzle-orm';
import { deployments, deploymentKubeReferences, environments, projectServices, projects } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import { toDeploymentRow } from './deployment-row.mapper';
import { lockDeploymentProjectsWithExecutor } from './deployments.query';
import { stopInactiveDeploymentBuildsForArchivedProjects } from './deployment-archive.query';
import type {
  DeploymentRow,
  DeploymentTransaction,
  LockedDeploymentProjectRow,
  PersistedDeploymentRow,
} from './deployments.query.types';
import type {
  BuildQueueCountsRow,
  OrphanedDeploymentBuildClaimPartition,
  OrphanedDeploymentBuildClaimRow,
  QueuedDeploymentClaimCandidateRow,
  UpdatedDeploymentIdRow,
} from './deployment-claim.query.types';

const buildQueueAdvisoryLockId: number = 728_050_385;

const activeBuildsCommonTableExpression: SQL = sql`
  active_builds as (
    select
      ${projects.organizationId} as organization_id,
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
    group by ${projects.organizationId}
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
    where ${deployments.status} = ${'queued'}
      and ${projects.archivedAt} is null
  ) as candidate
  left join active_builds on active_builds.organization_id = candidate.organization_id
  cross join total_active_builds
`;

const fairBuildCandidateOrder: SQL = sql`
  order by
    coalesce(active_builds.active_build_count, 0),
    candidate.created_at,
    candidate.deployment_id
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

export async function findFirstFairQueuedDeploymentCandidate(
  tx: DeploymentTransaction,
  maximumConcurrentBuilds: number,
  maximumConcurrentBuildsPerOrganization: number,
): Promise<QueuedDeploymentClaimCandidateRow | undefined> {
  await tx.execute(sql`select pg_advisory_xact_lock(${buildQueueAdvisoryLockId})`);
  const rows: object[] = (
    await tx.execute(fairQueuedDeploymentClaimQuery(maximumConcurrentBuilds, maximumConcurrentBuildsPerOrganization))
  ).rows;

  return rows[0] as QueuedDeploymentClaimCandidateRow | undefined;
}

function fairQueuedDeploymentClaimQuery(
  maximumConcurrentBuilds: number,
  maximumConcurrentBuildsPerOrganization: number,
): SQL<QueuedDeploymentClaimCandidateRow> {
  return sql<QueuedDeploymentClaimCandidateRow>`
    with
      ${activeBuildsCommonTableExpression}
      ${totalActiveBuildsCommonTableExpression}
    ${queuedBuildCandidateSelection}
    where total_active_builds.active_build_count < ${maximumConcurrentBuilds}
      and coalesce(active_builds.active_build_count, 0) < ${maximumConcurrentBuildsPerOrganization}
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

export async function requeueOrphanedDeploymentBuildClaims(staleBefore: Date): Promise<number> {
  return await getApiDatabase().transaction(
    async (tx: DeploymentTransaction): Promise<number> =>
      await recoverOrphanedDeploymentBuildClaimsWithExecutor(tx, staleBefore),
  );
}

async function recoverOrphanedDeploymentBuildClaimsWithExecutor(
  tx: DeploymentTransaction,
  staleBefore: Date,
): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(${buildQueueAdvisoryLockId})`);
  const candidates: OrphanedDeploymentBuildClaimRow[] = await listOrphanedDeploymentBuildClaims(tx, staleBefore);
  if (candidates.length === 0) {
    return 0;
  }
  const lockedProjects: LockedDeploymentProjectRow[] = await lockDeploymentProjectsWithExecutor(
    tx,
    candidates.map((candidate: OrphanedDeploymentBuildClaimRow): string => candidate.environmentId),
  );
  const partition: OrphanedDeploymentBuildClaimPartition = partitionOrphanedDeploymentBuildClaims(
    candidates,
    lockedProjects,
  );
  const recoveredAt: Date = new Date();
  const requeuedCount: number = await requeueActiveOrphanedDeploymentBuildClaims(
    tx,
    partition.activeDeploymentIds,
    staleBefore,
    recoveredAt,
  );
  await stopInactiveDeploymentBuildsForArchivedProjects(tx, partition.archivedDeploymentIds, recoveredAt, staleBefore);
  return requeuedCount;
}

async function listOrphanedDeploymentBuildClaims(
  tx: DeploymentTransaction,
  staleBefore: Date,
): Promise<OrphanedDeploymentBuildClaimRow[]> {
  return await tx
    .select({ deploymentId: deployments.id, environmentId: deployments.environmentId })
    .from(deployments)
    .where(buildOrphanedDeploymentClaimFilter(tx, staleBefore));
}

function partitionOrphanedDeploymentBuildClaims(
  candidates: OrphanedDeploymentBuildClaimRow[],
  lockedProjects: LockedDeploymentProjectRow[],
): OrphanedDeploymentBuildClaimPartition {
  const projectsByEnvironmentId: Map<string, LockedDeploymentProjectRow> = new Map<string, LockedDeploymentProjectRow>(
    lockedProjects.map((project: LockedDeploymentProjectRow): [string, LockedDeploymentProjectRow] => [
      project.environmentId,
      project,
    ]),
  );
  const partition: OrphanedDeploymentBuildClaimPartition = { activeDeploymentIds: [], archivedDeploymentIds: [] };
  for (const candidate of candidates) {
    const project: LockedDeploymentProjectRow | undefined = projectsByEnvironmentId.get(candidate.environmentId);
    if (project === undefined) {
      throw new Error(`Project for deployment ${candidate.deploymentId} was not found.`);
    }
    (project.archivedAt === null ? partition.activeDeploymentIds : partition.archivedDeploymentIds).push(
      candidate.deploymentId,
    );
  }
  return partition;
}

async function requeueActiveOrphanedDeploymentBuildClaims(
  tx: DeploymentTransaction,
  deploymentIds: string[],
  staleBefore: Date,
  recoveredAt: Date,
): Promise<number> {
  if (deploymentIds.length === 0) {
    return 0;
  }
  const requeued: UpdatedDeploymentIdRow[] = await tx
    .update(deployments)
    .set({ status: 'queued', updatedAt: recoveredAt })
    .where(and(inArray(deployments.id, deploymentIds), buildOrphanedDeploymentClaimFilter(tx, staleBefore)))
    .returning({ id: deployments.id });
  return requeued.length;
}

function buildOrphanedDeploymentClaimFilter(executor: DeploymentTransaction, staleBefore: Date): SQL | undefined {
  return and(
    eq(deployments.status, 'running'),
    eq(deployments.isActive, false),
    lte(deployments.updatedAt, staleBefore),
    notExists(
      executor
        .select({ deploymentId: deploymentKubeReferences.deploymentId })
        .from(deploymentKubeReferences)
        .where(eq(deploymentKubeReferences.deploymentId, deployments.id)),
    ),
  );
}
