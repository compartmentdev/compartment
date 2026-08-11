import { sql, type SQL } from 'drizzle-orm';
import { deploymentRoutes, deployments, environments, projects, projectServices } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  activeProjectDeploymentStatsSource,
  buildAttentionDeploymentExpression,
  buildLifecycleStoppedDeploymentExpression,
  buildSearchFilter,
  buildStatusRankExpression,
  buildUpdatingDeploymentExpression,
  latestServiceDeploymentStatsSource,
  readProjectArchiveStateFilter,
  readProjectRankOrderClause,
} from './project-list.query.helpers';
import { toProjectListRowsPage } from './project-list.query.mapper';
import type {
  ListOverviewProjectRowsPageByOrganizationInput,
  ProjectListPageQueryRow,
  ProjectListRowsPage,
} from './project-list.query.types';

const projectListPageSelect: SQL = sql`select
  pagination_state.page as "page",
  pagination_state.per_page as "perPage",
  pagination_state.total_items as "totalItems",
  pagination_state.total_pages as "totalPages",
  ranked_projects.project_id as "projectId",
  ranked_projects.project_name as "projectName",
  ranked_projects.default_access_mode as "defaultAccessMode",
  ranked_projects.organization_id as "organizationId",
  ranked_projects.archived_at as "archivedAt",
  ranked_projects.created_at as "createdAt",
  ranked_projects.updated_at as "updatedAt"
from pagination_state
left join ranked_projects
  on ranked_projects.list_rank > pagination_state.page_offset
  and ranked_projects.list_rank <= pagination_state.page_offset + pagination_state.per_page
order by ranked_projects.list_rank`;

const scopedProjectsSelect: SQL = sql`select
  ${projects.id} as project_id,
  ${projects.name} as project_name,
  ${projects.defaultAccessMode} as default_access_mode,
  ${projects.organizationId} as organization_id,
  ${projects.archivedAt} as archived_at,
  ${projects.createdAt} as created_at,
  ${projects.updatedAt} as updated_at
from ${projects}`;

const projectOverviewIndexSelect: SQL = sql`select
  scoped_projects.*,
  coalesce(project_service_counts.service_count, 0)::int as service_count,
  project_overview_stats.last_deployment_created_at,
  project_overview_stats.route_url,
  ${buildStatusRankExpression()} as status_rank`;

const projectServiceCountsLateral: SQL = sql`(
  select count(${projectServices.id})::int as service_count
  from ${projectServices}
  where ${projectServices.projectId} = scoped_projects.project_id
) project_service_counts`;

const projectDeploymentsCte: SQL = sql`project_deployments as (
  select
    ${environments.id} as environment_id,
    ${projectServices.id} as project_service_id,
    ${projectServices.name} as service_name,
    ${deployments.id} as deployment_id,
    ${deployments.createdAt} as deployment_created_at,
    ${deployments.health} as deployment_health,
    ${deployments.isActive} as deployment_is_active,
    ${deployments.promotionStage} as deployment_promotion_stage,
    ${deployments.status} as deployment_status,
    ${deploymentRoutes.subdomain} as route_subdomain
  from ${environments}
  inner join ${deployments} on ${deployments.environmentId} = ${environments.id}
  inner join ${projectServices} on ${projectServices.id} = ${deployments.projectServiceId}
  left join ${deploymentRoutes} on ${deploymentRoutes.deploymentId} = ${deployments.id}
  where scoped_projects.archived_at is null
    and ${environments.projectId} = scoped_projects.project_id
)`;

const latestServiceDeploymentsCte: SQL = sql`latest_service_deployments as (
  select ranked_project_deployments.*
  from (
    select
      project_deployments.*,
      row_number() over (
        partition by project_deployments.environment_id, project_deployments.project_service_id
        order by project_deployments.deployment_created_at desc, project_deployments.deployment_id desc
      ) as service_deployment_rank
    from project_deployments
  ) ranked_project_deployments
  where ranked_project_deployments.service_deployment_rank = 1
)`;

const activeProjectDeploymentsCte: SQL = sql`active_project_deployments as (
  select project_deployments.*
  from project_deployments
  where project_deployments.deployment_is_active = true
)`;

const projectOverviewStatsSelect: SQL = sql`select
  count(latest_service_deployments.project_service_id)::int as deployment_count,
  max(latest_service_deployments.deployment_created_at) as last_deployment_created_at,
  bool_or(${buildAttentionDeploymentExpression(latestServiceDeploymentStatsSource)}) as has_attention_deployment,
  bool_or(${buildUpdatingDeploymentExpression(latestServiceDeploymentStatsSource)}) as has_updating_deployment,
  bool_and(${buildLifecycleStoppedDeploymentExpression(latestServiceDeploymentStatsSource)}) as has_only_stopped_deployments,
  (
    select count(*)::int
    from active_project_deployments
  ) as active_deployment_count,
  (
    select bool_or(${buildAttentionDeploymentExpression(activeProjectDeploymentStatsSource)})
    from active_project_deployments
  ) as active_has_attention_deployment,
  (
    select primary_project_route.route_url
    from primary_project_route
    limit 1
  ) as route_url
from latest_service_deployments`;

export async function listOverviewProjectRowsPageByOrganization(
  input: ListOverviewProjectRowsPageByOrganizationInput,
): Promise<ProjectListRowsPage> {
  const rows: object[] = (await getApiDatabase().execute(buildProjectListPageQuery(input))).rows;
  return toProjectListRowsPage(rows as ProjectListPageQueryRow[]);
}

function buildProjectListPageQuery(input: ListOverviewProjectRowsPageByOrganizationInput): SQL {
  const archiveFilter: SQL = readProjectArchiveStateFilter(input.archiveState);
  const searchFilter: SQL = buildSearchFilter(input.search);
  const orderClause: SQL = readProjectRankOrderClause(input.orderBy, input.sort);

  return sql<ProjectListPageQueryRow>`
    with
      ${buildScopedProjectsCte(input, archiveFilter)},
      ${buildProjectOverviewIndexCte(input)},
      ${buildFilteredProjectsCte(searchFilter)},
      ${buildPaginationStateCte(input)},
      ${buildRankedProjectsCte(orderClause)}
    ${projectListPageSelect}
  `;
}

function buildScopedProjectsCte(input: ListOverviewProjectRowsPageByOrganizationInput, archiveFilter: SQL): SQL {
  return sql`scoped_projects as (
    ${scopedProjectsSelect}
    where ${projects.organizationId} = ${input.organizationId}
      and ${buildProjectIdsFilter(input.projectIds)}
      and ${archiveFilter}
  )`;
}

function buildProjectOverviewIndexCte(input: ListOverviewProjectRowsPageByOrganizationInput): SQL {
  return sql`project_overview_index as (
    ${projectOverviewIndexSelect}
    from scoped_projects
    left join lateral ${projectServiceCountsLateral} on true
    left join lateral ${buildProjectOverviewStatsLateral(input)} on true
  )`;
}

function buildProjectOverviewStatsLateral(input: ListOverviewProjectRowsPageByOrganizationInput): SQL {
  return sql`(
    with
      ${projectDeploymentsCte},
      ${latestServiceDeploymentsCte},
      ${activeProjectDeploymentsCte},
      ${buildPrimaryProjectRouteCte(input)}
    ${projectOverviewStatsSelect}
  ) project_overview_stats`;
}

function buildPrimaryProjectRouteCte(input: ListOverviewProjectRowsPageByOrganizationInput): SQL {
  return sql`primary_project_route as (
    select ranked_routes.route_url
    from (
      select
        lower(
          ${input.routeUrlPrefix}
          || (active_project_deployments.route_subdomain || '.' || ${input.routeBaseDomain})
          || ${input.routeUrlSuffix}
        ) as route_url,
        row_number() over (
          order by
            array_length(string_to_array(active_project_deployments.route_subdomain || '.' || ${input.routeBaseDomain}, '.'), 1),
            active_project_deployments.service_name
        ) as route_rank
      from active_project_deployments
      where active_project_deployments.route_subdomain is not null
    ) ranked_routes
    where ranked_routes.route_rank = 1
  )`;
}

function buildProjectIdsFilter(projectIds: readonly string[] | undefined): SQL {
  if (projectIds === undefined) {
    return sql`true`;
  }
  if (projectIds.length === 0) {
    return sql`false`;
  }

  return sql`${projects.id} in (${sql.join(
    projectIds.map((projectId: string): SQL => sql`${projectId}`),
    sql`, `,
  )})`;
}

function buildFilteredProjectsCte(searchFilter: SQL): SQL {
  return sql`filtered_projects as (
    select project_overview_index.*
    from project_overview_index
    where ${searchFilter}
  )`;
}

function buildPaginationStateCte(input: ListOverviewProjectRowsPageByOrganizationInput): SQL {
  return sql`pagination_state as (
    select
      page_state.page,
      page_state.per_page,
      page_counts.total_items,
      page_totals.total_pages,
      ((page_state.page - 1) * page_state.per_page)::int as page_offset
    from (
      select count(*)::int as total_items
      from filtered_projects
    ) page_counts
    cross join lateral (
      select greatest(1, ceil(page_counts.total_items::numeric / ${input.perPage})::int)::int as total_pages
    ) page_totals
    cross join lateral (
      select least(${input.page}, page_totals.total_pages)::int as page, ${input.perPage}::int as per_page
    ) page_state
  )`;
}

function buildRankedProjectsCte(orderClause: SQL): SQL {
  return sql`ranked_projects as (
    select
      filtered_projects.*,
      (row_number() over (order by ${orderClause}))::int as list_rank
    from filtered_projects
  )`;
}
