import type { PermissionKey } from '@compartment/contracts/browser';
import {
  readBrowserTablePageSize,
  readPositiveIntegerSearchParam,
  readTrimmedSearchParam,
} from '../../lib/server-table-query';
import { canManageBrowserRoles } from '../console/console-access';
import type {
  BrowserRolesPageSize,
  BrowserRolesSortBy,
  BrowserRolesSortDirection,
} from '../../services/browser-roles.service.types';

export interface RolesLoaderQuery {
  page: number;
  pageSize: BrowserRolesPageSize;
  searchQuery: string;
  sortBy: BrowserRolesSortBy;
  sortDirection: BrowserRolesSortDirection;
}

export function readRoleId(searchParams: URLSearchParams): string | null {
  const roleId: string | null = searchParams.get('roleId');
  return roleId === null || roleId === '' ? null : roleId;
}

export function readRolesLoaderQuery(searchParams: URLSearchParams): RolesLoaderQuery {
  return {
    page: readPositiveIntegerSearchParam(searchParams.get('page'), 1),
    pageSize: readBrowserTablePageSize(searchParams.get('pageSize') ?? ''),
    searchQuery: readTrimmedSearchParam(searchParams, 'q'),
    sortBy: readRolesSortBy(searchParams.get('sortBy')),
    sortDirection: readRolesSortDirection(searchParams.get('sortDirection')),
  };
}

export function readRolesMode(
  searchParams: URLSearchParams,
  roleId: string | null,
  permissions: PermissionKey[],
): 'create' | 'detail' | 'edit' | 'list' {
  const mode: string | null = searchParams.get('mode');
  if (mode === 'create' && canManageBrowserRoles(permissions)) {
    return 'create';
  }
  if (mode === 'edit' && roleId !== null && canManageBrowserRoles(permissions)) {
    return 'edit';
  }
  if (roleId !== null) {
    return 'detail';
  }

  return 'list';
}

function readRolesSortBy(value: string | null): BrowserRolesSortBy {
  switch (value) {
    case 'assignmentCount':
    case 'kind':
      return value;
    case null:
    default:
      return 'name';
  }
}

function readRolesSortDirection(value: string | null): BrowserRolesSortDirection {
  return value === 'desc' ? 'desc' : 'asc';
}
