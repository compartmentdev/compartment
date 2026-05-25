import type {
  BrowserProjectsPageSize,
  BrowserProjectsPageResult,
  BrowserProjectsSortBy,
  BrowserProjectsSortDirection,
} from '../../services/browser-projects.service.types';
import { browserProjectsPathname } from '../../browser-public-paths';
import {
  buildServerTableHref,
  readNextServerTableSortDirection,
  type ServerTableHrefDefaults,
  type ServerTableHrefOverrides,
} from '../../lib/server-table-query';

type ProjectsHrefOverrides = ServerTableHrefOverrides<
  BrowserProjectsSortBy,
  BrowserProjectsSortDirection,
  BrowserProjectsPageSize
>;

const projectsHrefDefaults: ServerTableHrefDefaults<
  BrowserProjectsSortBy,
  BrowserProjectsSortDirection,
  BrowserProjectsPageSize
> = {
  archiveState: 'active',
  page: 1,
  pageSize: 10,
  sortBy: 'updated',
  sortDirection: 'desc',
};

export function buildProjectsHref(data: BrowserProjectsPageResult, overrides?: ProjectsHrefOverrides): string {
  return buildServerTableHref(browserProjectsPathname, data, projectsHrefDefaults, overrides);
}

export function readNextSortDirection(
  data: BrowserProjectsPageResult,
  sortBy: BrowserProjectsSortBy,
): BrowserProjectsSortDirection {
  return readNextServerTableSortDirection(
    data.sortBy,
    data.sortDirection,
    sortBy,
    sortBy === 'project' ? 'asc' : 'desc',
  );
}
