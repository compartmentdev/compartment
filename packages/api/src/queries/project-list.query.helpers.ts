import type { ListSortDirection, ProjectArchiveState, ProjectListOrderBy } from '@compartment/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { projects } from '../db/schema';

interface DeploymentStatsSource {
  deploymentHealth: SQL;
  deploymentIsActive: SQL;
  deploymentPromotionStage: SQL;
  deploymentStatus: SQL;
}

const projectArchiveStateFilters: Record<ProjectArchiveState, SQL> = {
  active: sql`${projects.archivedAt} is null`,
  all: sql`true`,
  archived: sql`${projects.archivedAt} is not null`,
};

const projectNameAscTieBreaker: SQL = sql`filtered_projects.project_name asc`;

const projectRankOrderClauses: Record<ProjectListOrderBy, Record<ListSortDirection, SQL>> = {
  lastDeploymentCreatedAt: {
    asc: sql`filtered_projects.last_deployment_created_at asc nulls first, ${projectNameAscTieBreaker}`,
    desc: sql`filtered_projects.last_deployment_created_at desc nulls last, ${projectNameAscTieBreaker}`,
  },
  name: {
    asc: sql`filtered_projects.project_name asc`,
    desc: sql`filtered_projects.project_name desc`,
  },
  serviceCount: {
    asc: sql`filtered_projects.service_count asc, ${projectNameAscTieBreaker}`,
    desc: sql`filtered_projects.service_count desc, ${projectNameAscTieBreaker}`,
  },
  status: {
    asc: sql`filtered_projects.status_rank asc, ${projectNameAscTieBreaker}`,
    desc: sql`filtered_projects.status_rank desc, ${projectNameAscTieBreaker}`,
  },
  updatedAt: {
    asc: sql`filtered_projects.updated_at asc, ${projectNameAscTieBreaker}`,
    desc: sql`filtered_projects.updated_at desc, ${projectNameAscTieBreaker}`,
  },
};

export const activeProjectDeploymentStatsSource: DeploymentStatsSource = {
  deploymentHealth: sql`active_project_deployments.deployment_health`,
  deploymentIsActive: sql`active_project_deployments.deployment_is_active`,
  deploymentPromotionStage: sql`active_project_deployments.deployment_promotion_stage`,
  deploymentStatus: sql`active_project_deployments.deployment_status`,
};

export const latestServiceDeploymentStatsSource: DeploymentStatsSource = {
  deploymentHealth: sql`latest_service_deployments.deployment_health`,
  deploymentIsActive: sql`latest_service_deployments.deployment_is_active`,
  deploymentPromotionStage: sql`latest_service_deployments.deployment_promotion_stage`,
  deploymentStatus: sql`latest_service_deployments.deployment_status`,
};

export function readProjectArchiveStateFilter(archiveState: ProjectArchiveState): SQL {
  return projectArchiveStateFilters[archiveState];
}

export function buildSearchFilter(search: string | null): SQL {
  if (search === null) {
    return sql`true`;
  }

  return sql`strpos(
    lower(project_overview_index.project_name || ' ' || coalesce(project_overview_index.route_url, '')),
    ${search}
  ) > 0`;
}

export function readProjectRankOrderClause(orderBy: ProjectListOrderBy, sort: ListSortDirection): SQL {
  return projectRankOrderClauses[orderBy][sort];
}

export function buildStatusRankExpression(): SQL {
  return sql`case
    when scoped_projects.archived_at is not null then 1
    when coalesce(project_overview_stats.deployment_count, 0) = 0 then 0
    when coalesce(project_overview_stats.has_attention_deployment, false)
      or coalesce(project_overview_stats.active_has_attention_deployment, false) then 5
    when coalesce(project_overview_stats.has_updating_deployment, false) then 4
    when coalesce(project_overview_stats.active_deployment_count, 0) > 0 then 3
    when coalesce(project_overview_stats.has_only_stopped_deployments, false) then 2
    else 5
  end`;
}

export function buildAttentionDeploymentExpression(source: DeploymentStatsSource): SQL {
  return sql`(
    (${source.deploymentStatus} = 'failed' or ${source.deploymentHealth} = 'unhealthy')
    and not (${buildArchiveStoppedDeploymentExpression(source)})
  )`;
}

export function buildUpdatingDeploymentExpression(source: DeploymentStatsSource): SQL {
  return sql`(
    (
      ${source.deploymentStatus} = 'queued'
      or ${source.deploymentStatus} = 'running'
      or ${source.deploymentHealth} = 'pending'
      or ${source.deploymentPromotionStage} not in ('active', 'stopped')
    )
    and not (${buildArchiveStoppedDeploymentExpression(source)})
  )`;
}

export function buildLifecycleStoppedDeploymentExpression(source: DeploymentStatsSource): SQL {
  return sql`(
    (${source.deploymentStatus} = 'stopped' and ${source.deploymentPromotionStage} = 'stopped')
    or ${buildArchiveStoppedDeploymentExpression(source)}
  )`;
}

function buildArchiveStoppedDeploymentExpression(source: DeploymentStatsSource): SQL {
  return sql`(
    ${source.deploymentIsActive} = false
    and ${source.deploymentStatus} = 'succeeded'
    and ${source.deploymentHealth} = 'unhealthy'
    and ${source.deploymentPromotionStage} = 'rolled_back'
  )`;
}
