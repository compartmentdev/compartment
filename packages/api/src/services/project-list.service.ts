import type {
  ListSortDirection,
  ProjectArchiveState,
  ProjectListDetail,
  ProjectListOrderBy,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import type { OrganizationRow } from '../queries/organizations.query.types';
import { listOverviewProjectRowsPageByOrganization } from '../queries/project-list.query';
import type { ProjectListRowsPage } from '../queries/project-list.query.types';
import { listProjectsByIds, listProjectsByOrganization } from '../queries/projects.query';
import type { ProjectRow } from '../queries/projects.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { buildPublicRouteUrl } from './public-hosts.service';
import { filterListItemsBySearch } from './list-search.service.helpers';
import { paginateListItems, type ListPaginationResult } from './list-pagination.service.helpers';
import { buildProjectOverviewSummaries } from './project-list-overview.service';
import { buildProjectStatusSummaries } from './project-list-status.service';
import { buildProjectSummaryListItem } from './project-summary-list-item.service.helpers';
import { listVisibleProjectSummaries, type VisibleProjectSummary } from './project-visibility.service';
import { resolveRequiredOrganization } from './project-scope.service';
import type { ListProjectsInput, ProjectListResult, ProjectSummaryListItem } from './projects.service.types';

interface ProjectRouteUrlTemplate {
  prefix: string;
  suffix: string;
}

type ProjectSummaryOrderBy = Exclude<ProjectListOrderBy, 'lastDeploymentCreatedAt' | 'serviceCount' | 'status'>;

export async function listProjectListForPrincipal(input: ListProjectsInput): Promise<ProjectListResult> {
  const archiveState: ProjectArchiveState = resolveProjectArchiveState(input);
  const detail: ProjectListDetail = input.detail ?? 'summary';
  if (detail === 'status') {
    return await listProjectStatusForPrincipal(input);
  }
  const orderBy: ProjectListOrderBy = input.orderBy ?? 'name';
  const sort: ListSortDirection = input.sort ?? 'asc';
  const organization: OrganizationRow = await resolveRequiredOrganization(input.principalId, input.organizationSlug);
  const projects: VisibleProjectSummary[] = await readVisibleProjectsForPrincipal(input, organization, archiveState);
  if (detail === 'overview' || isOverviewProjectOrder(orderBy)) {
    return await listOverviewProjectPageForPrincipal(input, organization, projects, detail, orderBy, sort);
  }

  const pagination: ListPaginationResult<ProjectSummaryListItem> = paginateListItems(
    readOrderedProjectSummaryItems(projects, input.search, orderBy, sort),
    input.page ?? 1,
    input.perPage ?? 100,
  );

  return {
    detail: 'summary',
    pagination: pagination.pagination,
    projects: pagination.items,
  };
}

async function listProjectStatusForPrincipal(input: ListProjectsInput): Promise<ProjectListResult> {
  const organization: OrganizationRow = await resolveRequiredOrganization(input.principalId, input.organizationSlug);
  const projects: VisibleProjectSummary[] = await listVisibleProjectSummaries(
    organization.id,
    input.principalId,
    await listProjectsByIds(organization.id, input.projectIds ?? []),
  );

  return {
    detail: 'status',
    projects: await buildProjectStatusSummaries({
      projects,
    }),
  };
}

async function listOverviewProjectPageForPrincipal(
  input: ListProjectsInput,
  organization: OrganizationRow,
  projects: VisibleProjectSummary[],
  detail: ProjectListDetail,
  orderBy: ProjectListOrderBy,
  sort: ListSortDirection,
): Promise<ProjectListResult> {
  const projectPage: ProjectListRowsPage = await readOverviewProjectRowsPage(
    input,
    organization,
    projects,
    orderBy,
    sort,
  );
  const visibleProjectsById: Map<string, VisibleProjectSummary> = createVisibleProjectsById(projects);

  if (detail === 'overview') {
    return await buildOverviewProjectListResult(projectPage, visibleProjectsById);
  }

  return {
    detail: 'summary',
    pagination: projectPage.pagination,
    projects: projectPage.projects.map(buildProjectSummaryListItem),
  };
}

function createVisibleProjectsById(projects: VisibleProjectSummary[]): Map<string, VisibleProjectSummary> {
  return new Map<string, VisibleProjectSummary>(
    projects.map((project: VisibleProjectSummary): [string, VisibleProjectSummary] => [project.project.id, project]),
  );
}

async function readOverviewProjectRowsPage(
  input: ListProjectsInput,
  organization: OrganizationRow,
  projects: VisibleProjectSummary[],
  orderBy: ProjectListOrderBy,
  sort: ListSortDirection,
): Promise<ProjectListRowsPage> {
  const routeUrlTemplate: ProjectRouteUrlTemplate = buildProjectRouteUrlTemplate();

  return await listOverviewProjectRowsPageByOrganization({
    archiveState: resolveProjectArchiveState(input),
    orderBy,
    organizationId: organization.id,
    page: input.page ?? 1,
    perPage: input.perPage ?? 100,
    projectIds: projects.map((project: VisibleProjectSummary): string => project.project.id),
    routeBaseDomain: getApiConfig().baseDomain,
    routeUrlPrefix: routeUrlTemplate.prefix,
    routeUrlSuffix: routeUrlTemplate.suffix,
    search: normalizeProjectSearch(input.search),
    sort,
  });
}

function readOrderedProjectSummaryItems(
  projects: VisibleProjectSummary[],
  search: string | undefined,
  orderBy: ProjectSummaryOrderBy,
  sort: ListSortDirection,
): ProjectSummaryListItem[] {
  const items: ProjectSummaryListItem[] = projects.map(
    (project: VisibleProjectSummary): ProjectSummaryListItem => buildProjectSummaryListItem(project.project),
  );

  return sortProjectSummaryItems(filterProjectSummaryItems(items, search), orderBy, sort);
}

async function buildOverviewProjectListResult(
  projectPage: ProjectListRowsPage,
  visibleProjectsById: ReadonlyMap<string, VisibleProjectSummary>,
): Promise<ProjectListResult> {
  return {
    detail: 'overview',
    pagination: projectPage.pagination,
    projects: await buildProjectOverviewSummaries({
      projects: projectPage.projects.flatMap((project: ProjectRow): VisibleProjectSummary[] => {
        const visibleProject: VisibleProjectSummary | undefined = visibleProjectsById.get(project.id);
        return visibleProject === undefined ? [] : [visibleProject];
      }),
    }),
  };
}

async function readVisibleProjectsForPrincipal(
  input: ListProjectsInput,
  organization: OrganizationRow,
  archiveState: ProjectArchiveState,
): Promise<VisibleProjectSummary[]> {
  return await listVisibleProjectSummaries(
    organization.id,
    input.principalId,
    filterProjectsByArchiveState(
      await listProjectsByOrganization(organization.id, archiveState !== 'active'),
      archiveState,
    ),
  );
}

function resolveProjectArchiveState(input: ListProjectsInput): ProjectArchiveState {
  return input.archiveState ?? 'active';
}

function filterProjectsByArchiveState(projects: ProjectRow[], archiveState: ProjectArchiveState): ProjectRow[] {
  switch (archiveState) {
    case 'active':
      return projects.filter((project: ProjectRow): boolean => project.archivedAt === null);
    case 'archived':
      return projects.filter((project: ProjectRow): boolean => project.archivedAt !== null);
    case 'all':
      return projects;
  }
}

function filterProjectSummaryItems(
  projects: ProjectSummaryListItem[],
  search: string | undefined,
): ProjectSummaryListItem[] {
  return filterListItemsBySearch(projects, search, readProjectSearchText);
}

function sortProjectSummaryItems(
  projects: ProjectSummaryListItem[],
  orderBy: ProjectSummaryOrderBy,
  sort: ListSortDirection,
): ProjectSummaryListItem[] {
  const direction: number = sort === 'asc' ? 1 : -1;

  return [...projects].sort((left: ProjectSummaryListItem, right: ProjectSummaryListItem): number => {
    const comparison: number = compareProjectSummaryItems(left, right, orderBy);
    return comparison === 0 ? left.name.localeCompare(right.name) : comparison * direction;
  });
}

function compareProjectSummaryItems(
  left: ProjectSummaryListItem,
  right: ProjectSummaryListItem,
  orderBy: ProjectSummaryOrderBy,
): number {
  switch (orderBy) {
    case 'name':
      return left.name.localeCompare(right.name);
    case 'updatedAt':
      return left.updatedAt.getTime() - right.updatedAt.getTime();
  }
}

function readProjectSearchText(project: ProjectSummaryListItem): string {
  return project.name;
}

function isOverviewProjectOrder(
  orderBy: ProjectListOrderBy,
): orderBy is Exclude<ProjectListOrderBy, ProjectSummaryOrderBy> {
  return orderBy === 'lastDeploymentCreatedAt' || orderBy === 'serviceCount' || orderBy === 'status';
}

function normalizeProjectSearch(search: string | undefined): string | null {
  return hasText(search) ? search.trim().toLowerCase() : null;
}

function buildProjectRouteUrlTemplate(): ProjectRouteUrlTemplate {
  const routeHostMarker: string = '__compartment_route_host__';
  const routeUrl: string = buildPublicRouteUrl({ host: routeHostMarker }, getApiConfig());
  const markerIndex: number = routeUrl.indexOf(routeHostMarker);

  if (markerIndex === -1) {
    throw new Error('Expected route URL template marker.');
  }

  return {
    prefix: routeUrl.slice(0, markerIndex),
    suffix: routeUrl.slice(markerIndex + routeHostMarker.length),
  };
}
