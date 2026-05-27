import type { PermissionKey } from '@compartment/contracts/browser';
import {
  readBrowserTablePageSize,
  readPositiveIntegerSearchParam,
  readTrimmedSearchParam,
} from '../../lib/server-table-query';
import { canManageBrowserGroups } from '../console/console-access';
import type {
  BrowserGroupsPageSize,
  BrowserGroupsSortBy,
  BrowserGroupsSortDirection,
} from '../../services/browser-groups.service.types';

export interface GroupsLoaderQuery {
  page: number;
  pageSize: BrowserGroupsPageSize;
  searchQuery: string;
  sortBy: BrowserGroupsSortBy;
  sortDirection: BrowserGroupsSortDirection;
}

export function readSelectedGroupId(searchParams: URLSearchParams): string | null {
  const groupId: string | null = searchParams.get('groupId');
  return groupId === null || groupId === '' ? null : groupId;
}

export function readGroupsLoaderQuery(searchParams: URLSearchParams): GroupsLoaderQuery {
  return {
    page: readPositiveIntegerSearchParam(searchParams.get('page'), 1),
    pageSize: readBrowserTablePageSize(searchParams.get('pageSize') ?? ''),
    searchQuery: readTrimmedSearchParam(searchParams, 'q'),
    sortBy: readGroupsSortBy(searchParams.get('sortBy')),
    sortDirection: readGroupsSortDirection(searchParams.get('sortDirection')),
  };
}

export function readGroupsMode(
  searchParams: URLSearchParams,
  selectedGroupId: string | null,
  permissions: PermissionKey[],
): 'create' | 'detail' | 'list' {
  if (searchParams.get('mode') === 'create' && canManageBrowserGroups(permissions)) {
    return 'create';
  }
  if (selectedGroupId !== null) {
    return 'detail';
  }

  return 'list';
}

function readGroupsSortBy(value: string | null): BrowserGroupsSortBy {
  switch (value) {
    case 'assignmentCount':
    case 'memberCount':
      return value;
    case null:
    default:
      return 'name';
  }
}

function readGroupsSortDirection(value: string | null): BrowserGroupsSortDirection {
  return value === 'desc' ? 'desc' : 'asc';
}
