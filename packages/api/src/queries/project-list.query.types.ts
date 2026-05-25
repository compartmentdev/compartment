import type {
  ListPagination,
  ListSortDirection,
  ProjectArchiveState,
  ProjectListOrderBy,
} from '@compartment/contracts';
import type { ProjectRow } from './projects.query.types';

type ProjectListPageTimestampValue = Date | string;

export interface ListOverviewProjectRowsPageByOrganizationInput {
  archiveState: ProjectArchiveState;
  organizationId: string;
  orderBy: ProjectListOrderBy;
  page: number;
  perPage: number;
  projectIds?: readonly string[] | undefined;
  routeBaseDomain: string;
  routeUrlPrefix: string;
  routeUrlSuffix: string;
  search: string | null;
  sort: ListSortDirection;
}

export interface ProjectListRowsPage {
  pagination: ListPagination;
  projects: ProjectRow[];
}

interface ProjectListPagePaginationQueryRow {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

interface ProjectListPageEmptyQueryRow {
  archivedAt: null;
  createdAt: null;
  organizationId: null;
  projectId: null;
  projectName: null;
  updatedAt: null;
}

interface ProjectListPageProjectQueryRow {
  archivedAt: ProjectListPageTimestampValue | null;
  createdAt: ProjectListPageTimestampValue;
  organizationId: string;
  projectId: string;
  projectName: string;
  updatedAt: ProjectListPageTimestampValue;
}

export type ProjectListPageQueryRow = ProjectListPagePaginationQueryRow &
  (ProjectListPageEmptyQueryRow | ProjectListPageProjectQueryRow);
